import { checkChainLinkage, GENESIS } from './chain-linkage';

describe('POS fiscal chain-linkage', () => {
  it('empty chain is ok', () => {
    expect(checkChainLinkage([])).toEqual({ ok: true, issues: [] });
  });

  it('valid linear chain from genesis is ok', () => {
    const rows = [
      { prev: GENESIS, current: 'h1' },
      { prev: 'h1', current: 'h2' },
      { prev: 'h2', current: 'h3' },
    ];
    expect(checkChainLinkage(rows).ok).toBe(true);
  });

  it('no genesis flagged', () => {
    const rows = [
      { prev: 'x0', current: 'h1' },
      { prev: 'h1', current: 'h2' },
    ];
    const r = checkChainLinkage(rows);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.kind === 'no_genesis')).toBe(true);
    // x0 not found → orphan ; h1->h2 reachable depends on genesis walk → unreachable
    expect(r.issues.some((i) => i.kind === 'orphan')).toBe(true);
  });

  it('fork flagged when two rows share a prev', () => {
    const rows = [
      { prev: GENESIS, current: 'h1' },
      { prev: GENESIS, current: 'h1b' },
    ];
    const r = checkChainLinkage(rows);
    expect(r.issues.some((i) => i.kind === 'fork')).toBe(true);
    expect(r.issues.some((i) => i.kind === 'multiple_genesis')).toBe(true);
  });

  it('orphan + unreachable when a link is broken', () => {
    const rows = [
      { prev: GENESIS, current: 'h1' },
      { prev: 'MISSING', current: 'h2' },
    ];
    const r = checkChainLinkage(rows);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.kind === 'orphan')).toBe(true);
    expect(r.issues.some((i) => i.kind === 'unreachable')).toBe(true);
  });
});
