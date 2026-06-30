/**
 * POS-FE-164 — single roll-up verdict for the supervision page.
 * Synthesizes the 6 cards (health, outbox, reconciliation, stock signals) into one
 * headline so a manager sees the state at a glance instead of scanning every card.
 * Pure & unit-testable. Severity ladder: critical > watch > ok.
 */
export type VerdictLevel = 'ok' | 'watch' | 'critical';

export interface SupervisionInput {
  health?: { status?: string; database?: string; timewin?: string } | null;
  outbox?: { failed?: number; pending?: number } | null;
  reconciliation?: { timewinReachable?: boolean; discrepancies?: unknown[] } | null;
  stock?: { depletedCount?: number; lowCount?: number } | null;
}

export interface SupervisionVerdict {
  level: VerdictLevel;
  headline: string;
  reasons: string[];
}

export function summarizeSupervision(input: SupervisionInput): SupervisionVerdict {
  const reasons: string[] = [];
  let level: VerdictLevel = 'ok';
  const bump = (l: VerdictLevel) => {
    const rank = { ok: 0, watch: 1, critical: 2 };
    if (rank[l] > rank[level]) level = l;
  };

  const h = input.health;
  if (h) {
    if (h.status === 'down' || h.database === 'down') { bump('critical'); reasons.push('Système/DB indisponible'); }
    else if (h.status === 'degraded') { bump('watch'); reasons.push('Système dégradé'); }
    if (h.timewin === 'down') { bump('watch'); reasons.push('TimeWin injoignable'); }
  }

  const o = input.outbox;
  if (o) {
    if ((o.failed ?? 0) > 0) { bump('critical'); reasons.push(`${o.failed} event(s) outbox en échec`); }
    else if ((o.pending ?? 0) > 50) { bump('watch'); reasons.push(`File outbox élevée (${o.pending})`); }
  }

  const r = input.reconciliation;
  if (r) {
    const d = Array.isArray(r.discrepancies) ? r.discrepancies.length : 0;
    if (d > 0) { bump('watch'); reasons.push(`${d} écart(s) de rapprochement POS↔TimeWin`); }
    if (r.timewinReachable === false) { bump('watch'); reasons.push('TimeWin injoignable (rapprochement dégradé)'); }
  }

  const s = input.stock;
  if (s && (s.depletedCount ?? 0) > 0) { bump('watch'); reasons.push(`${s.depletedCount} produit(s) en rupture`); }

  const headlines: Record<VerdictLevel, string> = {
    critical: 'Critique — action immédiate requise',
    watch: 'À surveiller',
    ok: 'Tout est nominal',
  };

  return { level, headline: headlines[level], reasons };
}
