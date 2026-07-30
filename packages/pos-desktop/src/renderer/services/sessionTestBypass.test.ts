import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideSessionTestBypass } from './sessionTestBypass';

/**
 * MODE TEST pilote — décision PURE du contournement côté renderer. Miroir de la
 * garde serveur : activé par env (règle 7), limité au magasin/terminal pilotes
 * (règle 4), inerte hors mode test (règle 8).
 */
describe('decideSessionTestBypass — garde renderer du MODE TEST', () => {
  it('config absente / désactivée → false (règle 8)', () => {
    expect(decideSessionTestBypass(null, { storeIds: ['s1'], terminalId: 'TERMINAL 01' })).toBe(false);
    expect(
      decideSessionTestBypass({ enabled: false, stores: '', terminals: '' }, { storeIds: ['s1'], terminalId: 'TERMINAL 01' }),
    ).toBe(false);
  });

  it('activé sans liste blanche → true partout', () => {
    expect(
      decideSessionTestBypass({ enabled: true, stores: '', terminals: '' }, { storeIds: ['s1'], terminalId: 'TERMINAL 01' }),
    ).toBe(true);
  });

  it('liste magasins : seul un magasin pilote passe (match storeId OU SIRET)', () => {
    const cfg = { enabled: true, stores: 'store-pilote, 12345678900011', terminals: '' };
    expect(decideSessionTestBypass(cfg, { storeIds: ['store-pilote', 'siret-x'], terminalId: 'T01' })).toBe(true);
    expect(decideSessionTestBypass(cfg, { storeIds: ['autre', '12345678900011'], terminalId: 'T01' })).toBe(true);
    expect(decideSessionTestBypass(cfg, { storeIds: ['autre', 'siret-y'], terminalId: 'T01' })).toBe(false);
  });

  it('liste terminaux : seul le terminal pilote passe (règle 4)', () => {
    const cfg = { enabled: true, stores: '', terminals: 'TERMINAL 01,TERMINAL 02' };
    expect(decideSessionTestBypass(cfg, { storeIds: ['s1'], terminalId: 'TERMINAL 01' })).toBe(true);
    expect(decideSessionTestBypass(cfg, { storeIds: ['s1'], terminalId: 'TERMINAL 09' })).toBe(false);
  });

  it('magasin ET terminal doivent matcher quand les deux listes existent', () => {
    const cfg = { enabled: true, stores: 'store-pilote', terminals: 'TERMINAL 01' };
    expect(decideSessionTestBypass(cfg, { storeIds: ['store-pilote'], terminalId: 'TERMINAL 01' })).toBe(true);
    expect(decideSessionTestBypass(cfg, { storeIds: ['store-pilote'], terminalId: 'TERMINAL 09' })).toBe(false);
    expect(decideSessionTestBypass(cfg, { storeIds: ['autre'], terminalId: 'TERMINAL 01' })).toBe(false);
  });

  it('terminal inconnu (null) avec liste terminaux présente → refus', () => {
    const cfg = { enabled: true, stores: '', terminals: 'TERMINAL 01' };
    expect(decideSessionTestBypass(cfg, { storeIds: ['s1'], terminalId: null })).toBe(false);
  });
});

describe('garde-fous de source — MODE TEST cohérent avec les règles owner', () => {
  const banner = readFileSync(join(__dirname, '../components/pos/SessionTestBypassBanner.tsx'), 'utf8');
  const page = readFileSync(join(__dirname, '../pages/POSPage.tsx'), 'utf8');

  it('le bandeau affiche EXACTEMENT le libellé exigé (règle 5)', () => {
    expect(banner).toContain('MODE TEST — SESSION DE CAISSE NON VÉRIFIÉE');
  });

  it('le bandeau ne s\'affiche que si le mode test est activé (règle 8)', () => {
    expect(banner).toMatch(/if \(!cfg\.enabled\) return null/);
  });

  it('la garde de session est levée UNIQUEMENT sous bypass (règles 2 & 8)', () => {
    // La garde reste, mais gagne une condition `!sessionTestBypass`.
    expect(page).toMatch(/store\.posSessionOpenFailed && !store\.posSession\?\.id && !sessionTestBypass/);
  });

  it('les ventes du bypass sont marquées via l\'en-tête X-POS-Test-Mode (règle 6)', () => {
    // Le marqueur passe par l'option testMode (en-tête), PAS par un champ du corps
    // de salesApi.create → aucun 400 forbidNonWhitelisted sur un backend non à jour.
    expect(page).toMatch(/idempotencyKey, \{ testMode: markAsTest \}/);
    // Le corps de la requête EN LIGNE ne contient pas de champ isTest (la seule
    // occurrence restante est le marqueur de la FILE offline, jamais envoyé tel quel).
    expect(page).not.toMatch(/payments: toWirePayments\(payments\),\s*\.\.\.\(markAsTest \? \{ isTest: true \}/);
  });

  it('le marqueur test de la file offline n\'est PAS un champ de corps au rejeu (salePayload)', () => {
    const salePayload = readFileSync(join(__dirname, './salePayload.ts'), 'utf8');
    // toSyncCreateBody ne doit PAS réinjecter isTest dans le corps (header only).
    expect(salePayload).not.toMatch(/isTest: true/);
  });
});
