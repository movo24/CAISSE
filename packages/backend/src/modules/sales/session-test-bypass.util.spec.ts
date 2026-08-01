import { isSessionTestBypassEnabled } from './session-test-bypass.util';

/**
 * MODE TEST pilote — le SERVEUR est seul juge du contournement (règle 3), limité
 * au périmètre pilote (règle 4), désactivable par env sans code (règle 7), et
 * inerte hors mode test (règle 8). Ces tests verrouillent ces invariants.
 */
describe('isSessionTestBypassEnabled — garde serveur du MODE TEST pilote', () => {
  it('désactivé par défaut (env absent) → false (règle 8, comportement inchangé)', () => {
    expect(isSessionTestBypassEnabled({}, 'store-1', 'T01')).toBe(false);
  });

  it('POS_SESSION_TEST_BYPASS ≠ "true" → false (jamais activé par erreur)', () => {
    expect(isSessionTestBypassEnabled({ POS_SESSION_TEST_BYPASS: '1' }, 'store-1', 'T01')).toBe(false);
    expect(isSessionTestBypassEnabled({ POS_SESSION_TEST_BYPASS: 'false' }, 'store-1', 'T01')).toBe(false);
  });

  it('activé sans liste blanche → true partout (bypass global assumé)', () => {
    expect(isSessionTestBypassEnabled({ POS_SESSION_TEST_BYPASS: 'true' }, 'store-1', 'T01')).toBe(true);
  });

  it('liste de magasins : seul le magasin pilote passe (règle 4)', () => {
    const env = { POS_SESSION_TEST_BYPASS: 'true', POS_SESSION_TEST_BYPASS_STORES: 'store-pilote, store-2' };
    expect(isSessionTestBypassEnabled(env, 'store-pilote', 'T01')).toBe(true);
    expect(isSessionTestBypassEnabled(env, 'store-hors-perimetre', 'T01')).toBe(false);
  });

  it('liste de terminaux : seul le terminal pilote passe (règle 4)', () => {
    const env = { POS_SESSION_TEST_BYPASS: 'true', POS_SESSION_TEST_BYPASS_TERMINALS: 'TERMINAL 01,TERMINAL 02' };
    expect(isSessionTestBypassEnabled(env, 'store-1', 'TERMINAL 01')).toBe(true);
    expect(isSessionTestBypassEnabled(env, 'store-1', 'TERMINAL 09')).toBe(false);
  });

  it('liste de terminaux présente mais terminal inconnu (null) → refus (pas de fuite)', () => {
    const env = { POS_SESSION_TEST_BYPASS: 'true', POS_SESSION_TEST_BYPASS_TERMINALS: 'T01' };
    expect(isSessionTestBypassEnabled(env, 'store-1', null)).toBe(false);
    expect(isSessionTestBypassEnabled(env, 'store-1', undefined)).toBe(false);
  });

  it('magasin ET terminal doivent tous deux matcher quand les deux listes existent', () => {
    const env = {
      POS_SESSION_TEST_BYPASS: 'true',
      POS_SESSION_TEST_BYPASS_STORES: 'store-pilote',
      POS_SESSION_TEST_BYPASS_TERMINALS: 'T01',
    };
    expect(isSessionTestBypassEnabled(env, 'store-pilote', 'T01')).toBe(true);
    expect(isSessionTestBypassEnabled(env, 'store-pilote', 'T99')).toBe(false);
    expect(isSessionTestBypassEnabled(env, 'autre', 'T01')).toBe(false);
  });

  it('tolère les espaces autour des valeurs CSV', () => {
    const env = { POS_SESSION_TEST_BYPASS: 'true', POS_SESSION_TEST_BYPASS_STORES: '  store-1  ' };
    expect(isSessionTestBypassEnabled(env, 'store-1', 'T01')).toBe(true);
  });
});
