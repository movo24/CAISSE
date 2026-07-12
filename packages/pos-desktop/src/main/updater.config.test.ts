/**
 * Garde-fous de la migration per-user / MAJ silencieuse (v1.0.7).
 *
 * Ces tests LISENT les fichiers source réels (electron-builder.yml + updater.ts)
 * et échouent si un réglage critique régresse. Objectif : garantir durablement
 * qu'une caisse en production ne peut PLUS afficher d'assistant NSIS, de choix
 * « tous les utilisateurs / juste pour moi », ni d'invite UAC lors d'une MAJ, et
 * que les données du terminal ne sont jamais effacées.
 *
 * Volontairement sans dépendance (pas de parseur YAML) : on assied les
 * invariants sur le texte brut, ce qui reste vrai même si un dev réordonne le
 * fichier.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// vitest s'exécute avec cwd = racine du package (packages/pos-desktop).
const BUILDER_YML = path.resolve(process.cwd(), 'electron-builder.yml');
const UPDATER_TS = path.resolve(process.cwd(), 'src/main/updater.ts');

const yml = fs.readFileSync(BUILDER_YML, 'utf-8');
const updater = fs.readFileSync(UPDATER_TS, 'utf-8');

/** Lit un booléen scalaire `clé: true|false` (les clés visées sont uniques au bloc nsis). */
function boolKey(source: string, key: string): boolean | undefined {
  const m = source.match(new RegExp(`^\\s*${key}:\\s*(true|false)\\s*(#.*)?$`, 'm'));
  return m ? m[1] === 'true' : undefined;
}

describe('electron-builder nsis — installeur silencieux per-user', () => {
  it('oneClick:true → aucun assistant, aucun bouton Suivant/Fermer', () => {
    expect(boolKey(yml, 'oneClick')).toBe(true);
  });

  it('perMachine:false → installe dans le profil utilisateur (%LOCALAPPDATA%), jamais Program Files', () => {
    expect(boolKey(yml, 'perMachine')).toBe(false);
  });

  it('allowElevation:false → jamais d’élévation, donc jamais d’UAC pour l’employé', () => {
    expect(boolKey(yml, 'allowElevation')).toBe(false);
  });

  it('allowToChangeInstallationDirectory:false → pas de choix de dossier ni de page de portée', () => {
    expect(boolKey(yml, 'allowToChangeInstallationDirectory')).toBe(false);
  });

  it('runAfterFinish:true → le POS redémarre automatiquement après la MAJ', () => {
    expect(boolKey(yml, 'runAfterFinish')).toBe(true);
  });

  it('deleteAppDataOnUninstall:false → les données terminal ne sont jamais effacées', () => {
    expect(boolKey(yml, 'deleteAppDataOnUninstall')).toBe(false);
  });
});

describe('updater.ts — installation silencieuse et relance', () => {
  it('quitAndInstall(true, true) : isSilent=true (silencieux) + isForceRunAfter=true (relance)', () => {
    expect(/quitAndInstall\(\s*true\s*,\s*true\s*\)/.test(updater)).toBe(true);
  });

  it('aucune install non-silencieuse ne subsiste (quitAndInstall(false, …) interdit)', () => {
    expect(/quitAndInstall\(\s*false/.test(updater)).toBe(false);
  });

  it('autoInstallOnAppQuit reste activé (install à la fermeture, jamais en pleine vente)', () => {
    expect(/autoInstallOnAppQuit\s*=\s*true/.test(updater)).toBe(true);
  });
});

describe('regression — persistance des données utilisateur', () => {
  it('logs et config sont écrits sous userData (hors dossier d’install, donc préservés à la MAJ)', () => {
    // Les deux chemins persistés doivent dériver de app.getPath('userData').
    expect(/getPath\(\s*['"]userData['"]\s*\)/.test(updater)).toBe(true);
    // Et aucune écriture ne doit viser le dossier d'installation (process.resourcesPath / __dirname).
    expect(/appendFileSync\([^)]*resourcesPath/.test(updater)).toBe(false);
  });
});
