import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PR #30 — page Ventes backoffice : le backend (list/détail/void, gardes
 * fiscales) existait sans UI. Invariants source.
 */
const page = readFileSync(join(__dirname, '..', 'pages', 'SalesPage.tsx'), 'utf8');
const api = readFileSync(join(__dirname, '..', 'services', 'api.ts'), 'utf8');
const main = readFileSync(join(__dirname, '..', 'main.tsx'), 'utf8');
const layout = readFileSync(join(__dirname, '..', 'components', 'Layout.tsx'), 'utf8');

describe('SalesPage — invariants (source)', () => {
  it('is routed and in the manager-gated navigation', () => {
    expect(main).toMatch(/<Route path="\/sales" element=\{<SalesPage \/>\} \/>/);
    expect(layout).toMatch(/path: '\/sales', label: 'Ventes'[\s\S]{0,80}minRole: 'manager'/);
  });

  it('void requires a reason (min 3 chars) and is role-gated in the UI', () => {
    expect(page).toMatch(/voidReason\.trim\(\)\.length < 3/);
    expect(page).toMatch(/canVoid = role === 'admin' \|\| role === 'manager'/);
    expect(api).toMatch(/void: \(id: string, reason\?: string\)/);
  });

  it('server-side fiscal guard refusals are DISPLAYED, never bypassed', () => {
    expect(page).toMatch(/setVoidError\(e\?\.response\?\.data\?\.message/);
    expect(page).toMatch(/avoir/i); // the cash-realized → credit-note rule is stated to the manager
  });

  it('payment_pending (uncaptured card) and voided states are surfaced honestly', () => {
    expect(page).toMatch(/payment_pending/);
    expect(page).toMatch(/À régulariser/);
    expect(page).toMatch(/NON capturé/);
  });

  it('the list reloads after a successful void (UI reflects server state)', () => {
    expect(page).toMatch(/await salesApi\.void\(voidTarget\.id, voidReason\.trim\(\)\);[\s\S]{0,150}await load\(\);/);
  });
});
