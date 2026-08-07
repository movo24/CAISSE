#!/usr/bin/env node
/**
 * VERROU DE LIVRAISON — le paquet ne doit JAMAIS partir sans la voie d'impression GDI.
 *
 * Pourquoi ce script existe (fait vérifié le 2026-08-07) : la Release v1.10.1 a
 * été publiée et installée sur la caisse alors que son `app.asar` contenait
 * encore `webContents.print()` et AUCUNE trace de `printPngViaGdi`. Le correctif
 * n'était pas commité ; personne ne s'en est aperçu pendant douze versions,
 * parce que rien ne vérifiait le CONTENU de l'artefact réellement distribué.
 *
 * Les tests unitaires verrouillent les SOURCES. Ce script verrouille le PAQUET :
 * il inspecte l'`app.asar` produit par electron-builder et échoue (code 1) si
 *   - un marqueur obligatoire de la voie GDI manque, ou
 *   - un APPEL à `webContents.print(` subsiste (les mentions en commentaire,
 *     préfixées par `*`, sont tolérées : la cause racine est documentée là).
 *
 * Deux points de contrôle, tous deux nécessaires :
 *   1. `dist/main` — AVANT le packaging, donc AVANT toute publication. C'est le
 *      seul contrôle qui empêche une mauvaise Release de PARTIR (electron-builder
 *      `--publish always` publie dans la même commande que le packaging : un
 *      contrôle placé après serait un constat, pas un garde-fou).
 *   2. `app.asar` — APRÈS le packaging : prouve que ce qui a été empaqueté est
 *      bien ce qui a été compilé (aucune substitution, aucun cache périmé).
 *
 * Usage : node scripts/verify-print-path.mjs [chemin/app.asar | dossier]
 * Défaut : release/win-unpacked/resources/app.asar
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const DEFAULT_ASAR = 'release/win-unpacked/resources/app.asar';

/** Marqueurs sans lesquels le ticket ne peut PAS sortir physiquement. */
const REQUIRED = [
  'printPngViaGdi',        // remise du bitmap au pilote par GDI
  'POS_IMG_PRINTER',       // passage du nom d'imprimante par variable d'env
  'Format1bppIndexed',     // conversion 1 bit/pixel (pas de tramage pilote)
  'VisibleClipBounds',     // garde anti-rognage de la zone imprimable
  'computeBitmapHeightPx', // hauteur du bitmap = mesure réelle du ticket
  'offscreen-bitmap-gdi',  // marqueur de journal du chemin effectif
  'CaisseDiagnostic',      // artefacts HTML/PNG/PDF pour diagnostiquer sans la machine
];

/**
 * Compte les APPELS réels, en ignorant les lignes de commentaire de bloc.
 * Un appel s'écrit `xxx.webContents.print(` en début d'expression ; une mention
 * documentaire vit dans une ligne dont le premier caractère non blanc est `*`.
 */
function countRealCalls(text, needle) {
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(needle, idx)) >= 0) {
    const lineStart = text.lastIndexOf('\n', idx) + 1;
    const prefix = text.slice(lineStart, idx);
    const isComment = /^\s*\*/.test(prefix) || prefix.includes('//');
    if (!isComment) count++;
    idx += needle.length;
  }
  return count;
}

/** Concatène récursivement le contenu des .js d'un dossier compilé (dist/main). */
function readDirJs(dir) {
  let out = '';
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out += readDirJs(full);
    else if (entry.name.endsWith('.js')) out += readFileSync(full).toString('latin1') + '\n';
  }
  return out;
}

const target = resolve(process.argv[2] || DEFAULT_ASAR);
if (!existsSync(target)) {
  console.error(`[VERIFY-PRINT] INTROUVABLE : ${target}`);
  console.error('[VERIFY-PRINT] Compiler (build:main) ou packager avant la vérification.');
  process.exit(1);
}

// Dossier → on lit les .js compilés (contrôle AVANT publication).
// Fichier  → l'asar est une archive concaténée : une lecture binaire en latin1
// suffit pour y chercher des marqueurs ASCII, sans dépendance ni désarchivage.
const isDir = statSync(target).isDirectory();
const text = isDir ? readDirJs(target) : readFileSync(target).toString('latin1');
if (text.length === 0) {
  console.error(`[VERIFY-PRINT] ÉCHEC — aucun contenu lu dans ${target}`);
  process.exit(1);
}
const failures = [];

for (const marker of REQUIRED) {
  if (!text.includes(marker)) failures.push(`marqueur GDI MANQUANT : ${marker}`);
}

const calls = countRealCalls(text, 'webContents.print(');
if (calls > 0) {
  failures.push(
    `${calls} APPEL(S) à webContents.print( dans le paquet — ce chemin n'envoie ` +
      'aucune encre à la Star TSP100/TSP143 (61 octets mesurés).',
  );
}

if (failures.length > 0) {
  console.error('[VERIFY-PRINT] ÉCHEC — le paquet ne sortirait PAS de ticket :');
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`[VERIFY-PRINT] cible inspectée : ${target}`);
  process.exit(1);
}

console.log(
  `[VERIFY-PRINT] OK — voie GDI présente (${REQUIRED.length} marqueurs), ` +
    `0 appel à webContents.print. ${isDir ? 'dossier' : 'asar'} : ${target}`,
);
