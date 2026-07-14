// ── Graphiques SVG légers (aucune dépendance, optimisés mobile) ──
// Une courbe, des barres horizontales, une carte thermique jour×heure.
// Décoratif zéro : chaque pixel encode une donnée réelle.
// ─────────────────────────────────────────────────────────────────

import { formatMoneyCompact, ISO_DOW_LABELS } from '../lib/format';

export interface SeriesPoint {
  label: string;
  value: number;
}

/** Courbe d'évolution (CA / quantités) — SVG pur, responsive. */
export function LineChart({ points, compare, height = 120, currency = 'EUR' }: {
  points: SeriesPoint[];
  /** Série de comparaison optionnelle (pointillés). */
  compare?: SeriesPoint[];
  height?: number;
  currency?: string;
}) {
  if (!points.length) {
    return <p className="text-center text-xs text-mobile-muted py-6">Aucune vente sur la période</p>;
  }
  const W = 320;
  const H = height;
  const PAD = 6;
  const all = [...points.map((p) => p.value), ...(compare ?? []).map((p) => p.value)];
  const max = Math.max(...all, 1);
  const toPath = (pts: SeriesPoint[]) =>
    pts
      .map((p, i) => {
        const x = PAD + (i / Math.max(pts.length - 1, 1)) * (W - 2 * PAD);
        const y = H - PAD - (p.value / max) * (H - 2 * PAD);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  const last = points[points.length - 1];
  const first = points[0];
  return (
    <div className="bg-mobile-card rounded-2xl shadow-card p-3.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Évolution">
        {compare && compare.length > 1 && (
          <path d={toPath(compare)} fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="4 3" />
        )}
        <path d={toPath(points)} fill="none" stroke="#7c3aed" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
        {/* Point unique (ex. période « aujourd'hui ») : un path seul est invisible. */}
        {points.length === 1 && (
          <circle
            cx={W / 2}
            cy={H - PAD - (points[0].value / max) * (H - 2 * PAD)}
            r="4"
            fill="#7c3aed"
          />
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-mobile-muted mt-1">
        <span>{first.label}</span>
        <span className="font-semibold text-mobile-text">max {formatMoneyCompact(max, currency)}</span>
        <span>{last.label}</span>
      </div>
    </div>
  );
}

/** Barres horizontales classées (tops produits, magasins, catégories). */
export function BarList({ rows, valueLabel, onSelect }: {
  rows: Array<{ id: string; label: string; sub?: string; value: number; display: string }>;
  valueLabel?: string;
  onSelect?: (id: string) => void;
}) {
  if (!rows.length) {
    return <p className="text-center text-xs text-mobile-muted py-6">Aucune donnée sur la période</p>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="bg-mobile-card rounded-2xl shadow-card divide-y divide-mobile-border/50">
      {valueLabel && (
        <div className="px-3.5 pt-2.5 pb-1 text-[10px] uppercase tracking-wide text-mobile-muted font-semibold">{valueLabel}</div>
      )}
      {rows.map((r, i) => (
        <button
          key={r.id}
          onClick={onSelect ? () => onSelect(r.id) : undefined}
          disabled={!onSelect}
          className="w-full text-left px-3.5 py-2.5 flex items-center gap-3 disabled:cursor-default active:bg-mobile-subtle"
        >
          <span className="text-[11px] font-bold text-mobile-muted w-5 shrink-0 tabular-nums">{i + 1}</span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-mobile-text truncate">{r.label}</span>
            {r.sub && <span className="block text-[11px] text-mobile-muted truncate">{r.sub}</span>}
            <span className="block h-1 mt-1 rounded-full bg-mobile-subtle overflow-hidden">
              <span
                className="block h-full rounded-full bg-mobile-accent/70"
                style={{ width: `${Math.max((r.value / max) * 100, 2)}%` }}
              />
            </span>
          </span>
          <span className="text-sm font-bold tabular-nums shrink-0">{r.display}</span>
        </button>
      ))}
    </div>
  );
}

/** Carte thermique jour (lignes) × heure (colonnes). Intensité = CA. */
export function HeatmapGrid({ cells, currency = 'EUR' }: {
  cells: Array<{ isoDow: number; hour: number; revenueMinorUnits: number; tickets: number }>;
  currency?: string;
}) {
  if (!cells.length) {
    return <p className="text-center text-xs text-mobile-muted py-6">Aucune vente sur la période</p>;
  }
  const hours = Array.from(new Set(cells.map((c) => c.hour))).sort((a, b) => a - b);
  const byKey = new Map(cells.map((c) => [`${c.isoDow}:${c.hour}`, c]));
  const max = Math.max(...cells.map((c) => c.revenueMinorUnits), 1);
  const best = cells.reduce((a, b) => (b.revenueMinorUnits > a.revenueMinorUnits ? b : a));
  return (
    <div className="bg-mobile-card rounded-2xl shadow-card p-3.5 space-y-2">
      <div className="overflow-x-auto hide-scrollbar">
        <table className="border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th />
              {hours.map((h) => (
                <th key={h} className="text-[9px] font-medium text-mobile-muted px-0.5">{h}h</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
              <tr key={dow}>
                <td className="text-[10px] font-semibold text-mobile-muted pr-1.5">{ISO_DOW_LABELS[dow]}</td>
                {hours.map((h) => {
                  const c = byKey.get(`${dow}:${h}`);
                  const ratio = c ? c.revenueMinorUnits / max : 0;
                  return (
                    <td key={h}>
                      <div
                        className="w-5 h-5 rounded"
                        title={c ? `${ISO_DOW_LABELS[dow]} ${h}h — ${formatMoneyCompact(c.revenueMinorUnits, currency)} (${c.tickets} tickets)` : 'Aucune vente'}
                        style={{ backgroundColor: ratio ? `rgba(124, 58, 237, ${0.12 + ratio * 0.88})` : '#f1f5f9' }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-mobile-muted">
        Pic : <span className="font-semibold text-mobile-text">{ISO_DOW_LABELS[best.isoDow]} {best.hour}h</span>
        {' '}({formatMoneyCompact(best.revenueMinorUnits, currency)})
      </p>
    </div>
  );
}
