/**
 * Impression RAW ESC/POS via le spooler Windows (sans module natif).
 *
 * L'impression HTML (`posPrinting.ts`) passe par le driver et ne transporte
 * pas d'octets bruts : elle ne peut donc ni ouvrir le tiroir-caisse ni couper
 * le papier. Ce module envoie une séquence d'octets ESC/POS directement à
 * l'imprimante via le spooler, en RAW, grâce au `RawPrinterHelper` canonique
 * (P/Invoke winspool) exécuté par PowerShell. Aucune dépendance native →
 * n'alourdit pas le packaging.
 *
 * HONNÊTETÉ : toute défaillance résout `{ ok:false, error }` — jamais un faux
 * succès. Non-Windows → `{ ok:false }` explicite (le tiroir se pilote sur le
 * poste Windows réel). Ne throw jamais.
 *
 * ⚠️ Validation matérielle à faire sur le poste (impossible en CI headless).
 */
import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { drawerKickBytes, fullCutBytes, concatBytes } from './escpos';

// RawPrinterHelper canonique (Microsoft) : envoie le contenu binaire d'un
// fichier à une imprimante nommée, en datatype RAW. Chargé via -TypeDefinition.
const RAW_PRINTER_HELPER_CS = `
using System;
using System.IO;
using System.Runtime.InteropServices;
namespace PosCaisse {
  public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public struct DOCINFOA {
      [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
      [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
      [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
    public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, ref DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
    public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
      IntPtr hPrinter; DOCINFOA di = new DOCINFOA();
      di.pDocName = "POS Caisse RAW"; di.pDataType = "RAW";
      if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
      bool ok = false;
      try {
        if (StartDocPrinter(hPrinter, 1, ref di)) {
          if (StartPagePrinter(hPrinter)) {
            IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
            try {
              Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
              Int32 written; ok = WritePrinter(hPrinter, pUnmanaged, bytes.Length, out written);
            } finally { Marshal.FreeCoTaskMem(pUnmanaged); }
            EndPagePrinter(hPrinter);
          }
          EndDocPrinter(hPrinter);
        }
      } finally { ClosePrinter(hPrinter); }
      return ok;
    }
    public static bool SendFileToPrinter(string printerName, string fileName) {
      return SendBytesToPrinter(printerName, File.ReadAllBytes(fileName));
    }
  }
}`;

function runPowerShell(printerName: string, rawFile: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Le C# et les entrées passent par variables d'environnement (jamais par
    // interpolation shell → pas d'injection). Le script imprime OK / ERR:<msg>.
    const script = [
      '$ErrorActionPreference = "Stop"',
      'try {',
      '  Add-Type -TypeDefinition $env:POS_RAW_CS -Language CSharp',
      '  $ok = [PosCaisse.RawPrinterHelper]::SendFileToPrinter($env:POS_RAW_PRINTER, $env:POS_RAW_FILE)',
      '  if ($ok) { Write-Output "OK" } else { Write-Output "ERR:WritePrinter a échoué" }',
      '} catch { Write-Output ("ERR:" + $_.Exception.Message) }',
    ].join('\n');

    let stdout = '';
    let stderr = '';
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, POS_RAW_CS: RAW_PRINTER_HELPER_CS, POS_RAW_PRINTER: printerName, POS_RAW_FILE: rawFile } },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: 'raw print timeout' });
    }, 15_000);

    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e?.message || 'powershell spawn error' });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const out = stdout.trim();
      if (out.startsWith('OK')) return resolve({ ok: true });
      const msg = out.startsWith('ERR:') ? out.slice(4) : out || stderr.trim() || 'raw print failed';
      resolve({ ok: false, error: msg });
    });
  });
}

/** Envoie une séquence ESC/POS brute à une imprimante nommée (Windows). */
export async function sendRawEscpos(
  printerName: string,
  bytes: Uint8Array,
): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'impression RAW disponible uniquement sur Windows' };
  }
  if (!printerName) return { ok: false, error: 'aucune imprimante sélectionnée' };
  if (bytes.length === 0) return { ok: false, error: 'séquence vide' };

  const tmp = path.join(os.tmpdir(), `poscaisse-raw-${Date.now()}-${Math.round(process.hrtime()[1] % 1e6)}.bin`);
  try {
    fs.writeFileSync(tmp, Buffer.from(bytes));
    return await runPowerShell(printerName, tmp);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nettoyage best-effort */
    }
  }
}

/** Enregistre les canaux IPC RAW : ouverture tiroir + coupe + envoi brut. */
export function registerPosRawPrintIpc(): void {
  ipcMain.handle('pos-print:openDrawer', async (_e, deviceName?: unknown) => {
    const printer = typeof deviceName === 'string' ? deviceName : '';
    return sendRawEscpos(printer, drawerKickBytes(0));
  });
  ipcMain.handle('pos-print:cut', async (_e, deviceName?: unknown) => {
    const printer = typeof deviceName === 'string' ? deviceName : '';
    return sendRawEscpos(printer, fullCutBytes());
  });
  // Envoi brut générique (ouverture tiroir + coupe combinées, ou séquence libre
  // validée). `bytes` = tableau de nombres 0-255 fourni par le renderer.
  ipcMain.handle('pos-print:rawEscpos', async (_e, deviceName?: unknown, bytes?: unknown) => {
    const printer = typeof deviceName === 'string' ? deviceName : '';
    if (!Array.isArray(bytes)) return { ok: false, error: 'payload octets invalide' };
    const arr = Uint8Array.from(bytes.filter((n): n is number => typeof n === 'number' && n >= 0 && n <= 255));
    return sendRawEscpos(printer, arr.length ? arr : concatBytes());
  });
}
