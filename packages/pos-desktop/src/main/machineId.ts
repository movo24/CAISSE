/**
 * Identité machine STABLE (Partie B — enrôlement).
 *
 * La caisse a besoin d'un identifiant matériel stable, indépendant du navigateur
 * et du localStorage (qui peuvent être vidés), pour s'enrôler auprès du
 * back-office. On persiste un UUID dans le dossier `userData` d'Electron : il
 * survit aux redémarrages, aux mises à jour de l'app et au vidage du cache
 * renderer. Effacé uniquement si l'utilisateur supprime le profil de l'app.
 *
 * Aucune donnée sensible : un simple UUID opaque, jamais lié à une personne.
 */
import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

let cached: string | null = null;

function machineIdFile(): string {
  return path.join(app.getPath('userData'), 'machine-id.txt');
}

/** Lit l'identifiant machine persistant ; le crée à la première exécution. */
export function getOrCreateMachineId(): string {
  if (cached) return cached;
  const file = machineIdFile();
  try {
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (existing && existing.length >= 8) {
        cached = existing;
        return existing;
      }
    }
  } catch {
    // lecture impossible → on régénère (best-effort)
  }
  const id = randomUUID();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, id, 'utf8');
  } catch {
    // écriture impossible (disque plein / droits) → l'id reste en mémoire pour
    // la session ; il changera au prochain lancement, ce qui n'est pas idéal
    // mais ne casse rien (une nouvelle demande d'enrôlement sera créée).
  }
  cached = id;
  return id;
}

/** Expose `machine:getId` au renderer via le preload. */
export function registerMachineIdIpc(): void {
  ipcMain.handle('machine:getId', () => getOrCreateMachineId());
}
