import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TANT QU'UN TICKET N'EST PAS SORTI, LE PROBLÈME EST OUVERT.
 *
 * Six versions ont été publiées sans jamais VOIR ce que Chromium composait.
 * Chaque impression écrit désormais trois artefacts sur le Bureau, AVANT
 * d'envoyer quoi que ce soit au pilote — ils partitionnent la panne :
 *   HTML correct + PNG vide  → le rendu ne se fait pas ;
 *   PNG correct + PDF vide   → la composition d'impression échoue ;
 *   PDF correct + papier nul → le pilote Windows est en cause.
 */
const src = readFileSync(join(__dirname, 'posPrinting.ts'), 'utf8');
const page = readFileSync(join(__dirname, '..', 'renderer', 'pages', 'PrinterDiagnosticsPage.tsx'), 'utf8');

describe('les trois artefacts sont écrits AVANT l’impression', () => {
  it('HTML, PNG et PDF sont produits', () => {
    expect(src).toMatch(/\.html`\)/);
    expect(src).toMatch(/img\.toPNG\(\)/);
    expect(src).toMatch(/printToPDF\(/);
  });

  it('ils atterrissent dans un dossier trouvable par l’opérateur', () => {
    expect(src).toMatch(/'Desktop', 'CaisseDiagnostic'/);
  });

  it('ils sont écrits AVANT la remise GDI au pilote', () => {
    const artifacts = src.indexOf('writeDiagnosticArtifacts(win, html, geometry)');
    const print = src.indexOf('printPngViaGdi(pngPath, target)');
    expect(artifacts).toBeGreaterThan(-1);
    expect(print).toBeGreaterThan(artifacts);
  });

  it('un PDF vide n’est pas écrit comme s’il était valide', () => {
    expect(src).toMatch(/pdfBytes > 0/);
  });

  it('une capture vide n’est pas écrite non plus', () => {
    expect(src).toMatch(/!img\.isEmpty\(\)/);
  });

  it('un échec d’artefact ne bloque JAMAIS l’impression', () => {
    // Chaque écriture est dans son propre try/catch qui retombe sur null.
    expect(src).toMatch(/catch \{ htmlPath = null; \}/);
    expect(src).toMatch(/catch \{ pngPath = null; \}/);
    expect(src).toMatch(/catch \{ pdfPath = null; \}/);
  });
});

describe('journal complet exigé', () => {
  it('porte toutes les métriques de mesure', () => {
    // `windowWidthPx`/`windowHeightPx` sont remplacés par la géométrie du
    // bitmap GDI : `deviceWidthPx` (203 dpi) et `bitmapHeightPx`.
    for (const f of [
      'htmlBytes', 'scrollHeightPx', 'docScrollWidth', 'docScrollHeight',
      'bodyScrollWidth', 'bodyScrollHeight', 'deviceWidthPx', 'bitmapHeightPx',
      'pageWidthMicrons', 'pageHeightMicrons', 'imgsDecoded',
    ]) {
      expect(src).toContain(f);
    }
  });

  it('porte les chemins des trois artefacts', () => {
    for (const f of ['htmlPath', 'pngPath', 'pdfPath', 'pdfBytes']) {
      expect(src).toContain(f);
    }
  });

  it('porte l’imprimante et les options réellement transmises', () => {
    expect(src).toMatch(/deviceName: deviceName \?\? null/);
    // La « page » de la voie GDI est le bitmap lui-même : le journal doit dire
    // sa géométrie exacte plutôt qu'un format de page pilote.
    expect(src).toMatch(/bitmap GDI/);
  });
});

describe('fenêtre dimensionnée sur la mesure', () => {
  it('la fenêtre est redimensionnée à la hauteur réelle du ticket', () => {
    // Hauteur en POINTS IMPRIMANTE (203 dpi), calculée depuis la mesure CSS.
    expect(src).toMatch(/const bitmapHeightPx = computeBitmapHeightPx\(probe\.h\)/);
    expect(src).toMatch(/setContentSize\(render\.deviceWidthPx, bitmapHeightPx\)/);
  });

  it('le redimensionnement a lieu avant la capture des artefacts', () => {
    // On vise le SITE D'APPEL, pas la définition de la fonction (qui, elle,
    // est déclarée plus haut dans le fichier).
    const resize = src.indexOf('setContentSize(');
    const artifacts = src.indexOf('await writeDiagnosticArtifacts(win, html, geometry)');
    expect(resize).toBeGreaterThan(-1);
    expect(artifacts).toBeGreaterThan(resize);
  });
});

describe('bouton de test', () => {
  it('est nommé explicitement « Imprimer un ticket test complet »', () => {
    expect(page).toMatch(/Imprimer un ticket test complet/);
  });

  it('ne dépend ni d’une vente réelle ni du backend', () => {
    expect(page).toMatch(/buildTestTicket\(logo, qr, getPaperWidthMm\(\)\)/);
  });
});
