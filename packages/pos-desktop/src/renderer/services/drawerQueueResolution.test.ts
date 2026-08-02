// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  decideDrawerPath,
  describeQueueState,
  getDrawerQueueName,
  resolveDrawerQueue,
  setDrawerQueueName,
  type WindowsQueueState,
} from './drawerStrategy';

/**
 * Star TSP100/TSP143 (futurePRNT) — résolution de la file tiroir.
 *
 * Incident terrain : « [PERIPH] Drawer kick refused (honest) » sur une caisse
 * entièrement branchée. Cause = aucune file Windows dédiée au tiroir n'était
 * configurable de façon fiable (saisie libre → faute de frappe → refus muet de
 * Windows). Ces tests verrouillent la résolution ET les messages.
 */

const q = (over: Partial<WindowsQueueState> = {}): WindowsQueueState => ({
  name: 'Star TSP100 Cutter (TSP143)',
  driverName: 'Star TSP100 Cutter (TSP143)',
  portName: 'USB001',
  status: 'Normal',
  workOffline: false,
  queuedJobs: 0,
  ...over,
});

describe('resolveDrawerQueue — file tiroir mémorisée vs réalité Windows', () => {
  it('aucune file configurée → not_configured, message actionnable', () => {
    const r = resolveDrawerQueue('', ['Star TSP100 Cutter (TSP143)']);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('not_configured');
    expect(r.message).toMatch(/diagnostic/i);
  });

  it('file présente → résolue sur le nom EXACT Windows', () => {
    const r = resolveDrawerQueue('Star TSP143 (Tiroir)', ['Autre', 'Star TSP143 (Tiroir)']);
    expect(r).toEqual({ ok: true, queueName: 'Star TSP143 (Tiroir)' });
  });

  it('espaces de bord tolérés (copier-coller depuis Windows)', () => {
    const r = resolveDrawerQueue('  Star TSP143 (Tiroir)  ', ['Star TSP143 (Tiroir)']);
    expect(r.ok).toBe(true);
  });

  it('file mémorisée disparue → vanished, jamais un envoi à l’aveugle', () => {
    const r = resolveDrawerQueue('Star TSP143 (Tiroir)', ['Star TSP100 Cutter (TSP143)']);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('vanished');
    expect(r.configured).toBe('Star TSP143 (Tiroir)');
    expect(r.message).toContain('Star TSP143 (Tiroir)');
  });

  it('AUCUNE correspondance approximative — imprimer sur « presque la bonne » file est refusé', () => {
    const r = resolveDrawerQueue('Star TSP143 Tiroir', ['Star TSP143 (Tiroir)']);
    expect(r.ok).toBe(false);
  });
});

describe('describeQueueState — pourquoi le papier ne sort pas', () => {
  it('file saine et vide → aucun blocage', () => {
    expect(describeQueueState(q())).toBeNull();
  });

  it('hors connexion Windows → expliqué', () => {
    expect(describeQueueState(q({ workOffline: true }))).toMatch(/hors connexion/i);
  });

  it('file suspendue → expliqué', () => {
    expect(describeQueueState(q({ status: 'Paused' }))).toMatch(/suspendue/i);
  });

  it('imprimante en erreur → statut repris dans le message', () => {
    expect(describeQueueState(q({ status: 'PaperOut' }))).toMatch(/erreur/i);
  });

  it('jobs empilés alors que la file est « Normal » → signalé (cas « job soumis, rien ne sort »)', () => {
    expect(describeQueueState(q({ queuedJobs: 3 }))).toMatch(/3 job/);
  });

  it('file introuvable → dit explicitement', () => {
    expect(describeQueueState(null)).toMatch(/introuvable/i);
  });
});

describe('non-régression : décision de chemin inchangée', () => {
  it('Star raster SANS file tiroir → refus (jamais d’ESC/POS brut)', () => {
    const d = decideDrawerPath('star-raster', 'auto', null);
    expect(d.path).toBe('refuse');
  });

  it('Star raster AVEC file tiroir → job driver sur cette file', () => {
    const d = decideDrawerPath('star-raster', 'auto', 'Star TSP143 (Tiroir)');
    expect(d).toEqual({ path: 'queue', queueName: 'Star TSP143 (Tiroir)' });
  });

  it('imprimante ESC/POS réelle → kick brut conservé', () => {
    expect(decideDrawerPath('escpos', 'auto', null)).toEqual({ path: 'raw' });
  });

  it('driver inconnu → kick brut (comportement historique)', () => {
    expect(decideDrawerPath('unknown', 'auto', null)).toEqual({ path: 'raw' });
  });
});

describe('persistance de la file tiroir', () => {
  beforeEach(() => localStorage.clear());

  it('mémorise puis restaure le nom exact', () => {
    setDrawerQueueName('Star TSP143 (Tiroir)');
    expect(getDrawerQueueName()).toBe('Star TSP143 (Tiroir)');
  });

  it('valeur vide → effacée (pas de chaîne vide mémorisée)', () => {
    setDrawerQueueName('Star TSP143 (Tiroir)');
    setDrawerQueueName('   ');
    expect(getDrawerQueueName()).toBeNull();
  });
});
