/**
 * Traces horodatées de la chaîne d'impression — mesure de latence terrain.
 * La trace est passive : elle ne throw jamais et n'influe pas sur la vente.
 */
import { describe, it, expect } from 'vitest';
import { PrintChainTrace, type KeyValueStore } from './printChainTrace';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('PrintChainTrace', () => {
  it('enregistre des jalons ordonnés et calcule les durées', () => {
    const trace = new PrintChainTrace(memoryStore());
    const t0 = Date.now();
    trace.mark('sale-1', 'validate_click', undefined, t0);
    trace.mark('sale-1', 'sale_response', { ok: true }, t0 + 120);
    trace.mark('sale-1', 'print_result', { ok: true }, t0 + 950);
    const rows = trace.durations('sale-1');
    expect(rows.map((r) => r.step)).toEqual(['validate_click', 'sale_response', 'print_result']);
    expect(rows[1]).toMatchObject({ atMs: 120, sincePrevMs: 120 });
    expect(rows[2]).toMatchObject({ atMs: 950, sincePrevMs: 830 });
  });

  it('rétro-datage : un jalon `at` antérieur au premier mark est bien pris en compte', () => {
    const trace = new PrintChainTrace(memoryStore());
    const t0 = Date.now();
    trace.mark('sale-2', 'sale_request_start', undefined, t0 + 50);
    trace.mark('sale-2', 'validate_click', undefined, t0); // rétro-daté
    const rows = trace.durations('sale-2');
    expect(rows[0].step).toBe('validate_click'); // trié par temps, pas par insertion
  });

  it('persiste et recharge depuis le store', () => {
    const store = memoryStore();
    const a = new PrintChainTrace(store);
    a.mark('sale-3', 'validate_click');
    const b = new PrintChainTrace(store);
    expect(b.getTrace('sale-3')?.marks).toHaveLength(1);
  });

  it('latest() renvoie la vente la plus récente ; borne à 25 ventes', () => {
    const trace = new PrintChainTrace(memoryStore());
    for (let i = 0; i < 30; i++) trace.mark(`sale-${i}`, 'validate_click');
    expect(trace.latest()?.saleId).toBe('sale-29');
    expect(trace.list().length).toBeLessThanOrEqual(25);
  });

  it('ne throw jamais : saleId/step vides ignorés, store cassé toléré', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('boom');
      },
      setItem: () => {
        throw new Error('boom');
      },
    };
    const trace = new PrintChainTrace(broken);
    expect(() => trace.mark('', 'x')).not.toThrow();
    expect(() => trace.mark('s', '')).not.toThrow();
    expect(() => trace.mark('s', 'step')).not.toThrow();
    expect(trace.durations('absent')).toEqual([]);
  });
});
