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
): Promise<{ ok: boolean; error?: string; ms?: number }> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'impression RAW disponible uniquement sur Windows' };
  }
  if (!printerName) return { ok: false, error: 'aucune imprimante sélectionnée' };
  if (bytes.length === 0) return { ok: false, error: 'séquence vide' };

  const t0 = Date.now();
  const tmp = path.join(os.tmpdir(), `poscaisse-raw-${Date.now()}-${Math.round(process.hrtime()[1] % 1e6)}.bin`);
  try {
    fs.writeFileSync(tmp, Buffer.from(bytes));
    const res = await runPowerShell(printerName, tmp);
    const ms = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.info('[RAW-TIMING]', JSON.stringify({ printerName, bytes: bytes.length, ms, ok: res.ok, error: res.error }));
    return { ...res, ms };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nettoyage best-effort */
    }
  }
}

/**
 * Infos de la file Windows (driver + port) via `Get-Printer` — c'est le driver
 * qui dit le MODE RÉEL de l'imprimante (ex. « Star TSP100 Cutter (TSP143) » =
 * futurePRNT raster → ESC/POS brut inopérant). Lecture seule, jamais bloquant.
 */
export async function getPrinterInfo(
  printerName: string,
): Promise<{ ok: boolean; driverName?: string; portName?: string; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows uniquement' };
  if (!printerName) return { ok: false, error: 'aucune imprimante' };
  return new Promise((resolve) => {
    const script = [
      '$ErrorActionPreference = "Stop"',
      'try {',
      '  $p = Get-Printer -Name $env:POS_PRN_NAME',
      '  Write-Output ("OK:" + $p.DriverName + "|" + $p.PortName)',
      '} catch { Write-Output ("ERR:" + $_.Exception.Message) }',
    ].join('\n');
    let stdout = '';
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, POS_PRN_NAME: printerName } },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: 'Get-Printer timeout' });
    }, 10_000);
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e?.message || 'powershell spawn error' });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const out = stdout.trim();
      if (out.startsWith('OK:')) {
        const [driverName, portName] = out.slice(3).split('|');
        return resolve({ ok: true, driverName: driverName?.trim(), portName: portName?.trim() });
      }
      resolve({ ok: false, error: out.startsWith('ERR:') ? out.slice(4) : out || 'Get-Printer failed' });
    });
  });
}

/* ── État RÉEL des files Windows ─────────────────────────────────────────
 *
 * `webContents.print()` rend « success » dès que le job est REMIS AU SPOULEUR.
 * Cela ne prouve pas que le papier sort : une file hors connexion, suspendue,
 * ou en erreur accepte le job et l'empile indéfiniment. Sans cette lecture,
 * le terrain voit « impression réussie » et un tiroir muet, sans explication.
 * On lit donc l'état réel de CHAQUE file (statut, hors connexion, jobs en
 * attente) pour pouvoir le dire honnêtement à l'opérateur.
 */

/** Séparateur d'unité — un nom d'imprimante ne peut pas le contenir. */
const FIELD_SEP = '';

export interface QueueInfo {
  name: string;
  driverName: string;
  portName: string;
  /** Statut Windows brut (ex. « Normal », « Offline », « Paused », « Error »). */
  status: string;
  /** File marquée « Utiliser l'imprimante hors connexion ». */
  workOffline: boolean;
  /** Jobs en attente dans la file (-1 si non lisible). */
  queuedJobs: number;
}

/**
 * Parse la sortie PowerShell de `listPrinterQueues`. PUR et testable — c'est
 * ici que vit toute la logique fragile (aucune I/O).
 */
export function parseQueueLines(stdout: string): QueueInfo[] {
  const out: QueueInfo[] = [];
  for (const raw of String(stdout ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('Q' + FIELD_SEP)) continue;
    const parts = line.split(FIELD_SEP);
    // Q | name | driver | port | status | workOffline | jobs
    if (parts.length < 7) continue;
    const name = parts[1].trim();
    if (!name) continue;
    const jobs = Number.parseInt(parts[6].trim(), 10);
    out.push({
      name,
      driverName: parts[2].trim(),
      portName: parts[3].trim(),
      status: parts[4].trim() || 'Unknown',
      workOffline: /^true$/i.test(parts[5].trim()),
      queuedJobs: Number.isFinite(jobs) ? jobs : -1,
    });
  }
  return out;
}

// NB : l'INTERPRÉTATION de cet état (message opérateur) vit côté renderer, dans
// `drawerStrategy.describeQueueState` — une seule implémentation, pas deux
// jeux de règles à maintenir en parallèle. Ici on ne fait que LIRE Windows.

/** Liste toutes les files Windows avec leur état réel (une seule invocation). */
export async function listPrinterQueues(): Promise<{ ok: boolean; queues: QueueInfo[]; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, queues: [], error: 'Windows uniquement' };
  return new Promise((resolve) => {
    const script = [
      '$ErrorActionPreference = "Stop"',
      '$d = [char]31',
      'try {',
      '  foreach ($p in (Get-Printer | Sort-Object Name)) {',
      '    $jobs = -1',
      '    try { $jobs = (Get-PrintJob -PrinterName $p.Name -ErrorAction SilentlyContinue | Measure-Object).Count } catch { $jobs = -1 }',
      '    Write-Output ("Q" + $d + $p.Name + $d + $p.DriverName + $d + $p.PortName + $d + $p.PrinterStatus + $d + $p.WorkOffline + $d + $jobs)',
      '  }',
      '} catch { Write-Output ("ERR:" + $_.Exception.Message) }',
    ].join('\n');
    let stdout = '';
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env } },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, queues: [], error: 'Get-Printer timeout' });
    }, 12_000);
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, queues: [], error: e?.message || 'powershell spawn error' });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const errLine = stdout.split(/\r?\n/).find((l) => l.trim().startsWith('ERR:'));
      if (errLine) return resolve({ ok: false, queues: [], error: errLine.trim().slice(4) });
      resolve({ ok: true, queues: parseQueueLines(stdout) });
    });
  });
}

/**
 * Kick tiroir via FILE WINDOWS DÉDIÉE (imprimantes raster type TSP100/TSP143
 * futurePRNT, où l'ESC/POS brut est inopérant) : on imprime un job driver (GDI)
 * minuscule sur une file configurée « Peripheral Unit = Cash Drawer, ouverture
 * en début de document ». Un job = UNE impulsion. AUCUN octet brut n'est envoyé
 * — c'est le driver Star qui pilote le tiroir, exactement comme futurePRNT.
 */
export async function sendDrawerQueueJob(
  queueName: string,
): Promise<{ ok: boolean; error?: string; ms?: number }> {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows uniquement' };
  if (!queueName) return { ok: false, error: 'aucune file tiroir configurée' };
  const t0 = Date.now();
  return new Promise((resolve) => {
    const script = [
      '$ErrorActionPreference = "Stop"',
      'try {',
      // Un seul espace : job GDI minimal — le driver déclenche le tiroir, pas le contenu.
      '  " " | Out-Printer -Name $env:POS_DRAWER_QUEUE',
      '  Write-Output "OK"',
      '} catch { Write-Output ("ERR:" + $_.Exception.Message) }',
    ].join('\n');
    let stdout = '';
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, POS_DRAWER_QUEUE: queueName } },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: 'drawer queue timeout', ms: Date.now() - t0 });
    }, 15_000);
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e?.message || 'powershell spawn error', ms: Date.now() - t0 });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const ms = Date.now() - t0;
      const out = stdout.trim();
      // eslint-disable-next-line no-console
      console.info('[DRAWER-QUEUE-TIMING]', JSON.stringify({ queueName, ms, out }));
      if (out.startsWith('OK')) return resolve({ ok: true, ms });
      resolve({ ok: false, error: out.startsWith('ERR:') ? out.slice(4) : out || 'drawer queue failed', ms });
    });
  });
}

/** Enregistre les canaux IPC RAW : ouverture tiroir + coupe + envoi brut. */
export function registerPosRawPrintIpc(): void {
  // Ouverture tiroir. `opts.path` choisi par le renderer selon le MODE RÉEL du
  // driver (décision pure `decideDrawerPath`) : 'raw' = kick ESC/POS (imprimantes
  // ESC/POS), 'queue' = job driver vers la file Windows dédiée (TSP100/TSP143
  // futurePRNT — jamais d'octets bruts vers un firmware raster).
  ipcMain.handle('pos-print:openDrawer', async (_e, deviceName?: unknown, opts?: unknown) => {
    const printer = typeof deviceName === 'string' ? deviceName : '';
    const o = (opts && typeof opts === 'object' ? opts : {}) as { path?: unknown; queueName?: unknown };
    if (o.path === 'queue') {
      const queue = typeof o.queueName === 'string' ? o.queueName : '';
      return sendDrawerQueueJob(queue);
    }
    return sendRawEscpos(printer, drawerKickBytes(0));
  });

  // Lecture seule : état RÉEL de toutes les files (statut, hors connexion,
  // jobs en attente) — permet de dire pourquoi un job « réussi » ne sort pas.
  ipcMain.handle('pos-print:listQueues', async () => listPrinterQueues());

  // Lecture seule : driver + port de la file (détection du mode réel).
  ipcMain.handle('pos-print:getPrinterInfo', async (_e, deviceName?: unknown) => {
    const printer = typeof deviceName === 'string' ? deviceName : '';
    return getPrinterInfo(printer);
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
