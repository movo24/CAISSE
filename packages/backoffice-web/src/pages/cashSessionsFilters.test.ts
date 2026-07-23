import { describe, it, expect } from 'vitest';
import { buildSessionListParams, buildOffSessionParams } from './cashSessionsFilters';

describe('cashSessionsFilters — buildSessionListParams', () => {
  it('admin + magasin choisi → storeId transmis', () => {
    const p = buildSessionListParams({ isAdmin: true, selectedStoreId: 'store-b', withCashCountOnly: false });
    expect(p).toEqual({ limit: 100, withCashCountOnly: false, storeId: 'store-b' });
  });

  it('admin sans choix (« mon magasin ») → storeId ABSENT (le serveur retombe sur le JWT)', () => {
    const p = buildSessionListParams({ isAdmin: true, selectedStoreId: '', withCashCountOnly: false });
    expect(p.storeId).toBeUndefined();
  });

  it('non-admin → storeId JAMAIS transmis même si sélectionné (le TenantInterceptor bloquerait)', () => {
    const p = buildSessionListParams({ isAdmin: false, selectedStoreId: 'store-b', withCashCountOnly: true });
    expect(p.storeId).toBeUndefined();
    expect(p.withCashCountOnly).toBe(true);
  });

  it('storeId fait d’espaces → traité comme vide', () => {
    const p = buildSessionListParams({ isAdmin: true, selectedStoreId: '   ', withCashCountOnly: false });
    expect(p.storeId).toBeUndefined();
  });

  it('limit par défaut 100, surchargable', () => {
    expect(buildSessionListParams({ isAdmin: false, selectedStoreId: '', withCashCountOnly: false }).limit).toBe(100);
    expect(buildSessionListParams({ isAdmin: false, selectedStoreId: '', withCashCountOnly: false, limit: 25 }).limit).toBe(25);
  });
});

describe('cashSessionsFilters — buildOffSessionParams', () => {
  it('admin + magasin choisi → storeId transmis, days par défaut 14', () => {
    expect(buildOffSessionParams({ isAdmin: true, selectedStoreId: 'store-b' })).toEqual({ days: 14, storeId: 'store-b' });
  });
  it('non-admin → storeId jamais transmis', () => {
    expect(buildOffSessionParams({ isAdmin: false, selectedStoreId: 'store-b', days: 7 })).toEqual({ days: 7 });
  });
  it('admin sans choix → storeId absent', () => {
    expect(buildOffSessionParams({ isAdmin: true, selectedStoreId: '' }).storeId).toBeUndefined();
  });
});
