// ── Courbe multi-magasins interactive (SVG pur, tactile d'abord) ──
// - une courbe par magasin, couleur stable + nom réel en légende ;
// - crosshair au doigt (pointer events, pas de hover-only) : ligne
//   verticale + points mis en évidence, l'index remonte au parent qui
//   affiche l'infobulle/classement synchronisé SOUS le graphique ;
// - axe X complet (chaque heure / chaque date, densifié si nécessaire) ;
// - zéro réel affiché à 0 (jamais d'interpolation entre points distants) ;
// - toucher un nom de la légende = mise en évidence + atténuation des
//   autres ; second toucher = retour à la normale ;
// - `touch-action: none` sur le SVG : le graphique reste stable pendant
//   la lecture, pas de scroll involontaire.
// ─────────────────────────────────────────────────────────────────

import { useCallback, useRef } from 'react';

export interface ChartSeries {
  id: string;
  name: string;
  color: string;
  dashed?: boolean;
  /** null = valeur non calculable (trou honnête) ; 0 = zéro réel. */
  values: Array<number | null>;
}

const W = 340;
const H = 150;
const PAD_X = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 22;

export function MultiLineChart({
  labels,
  series,
  activeIndex,
  onIndexChange,
  highlightId,
  onToggleHighlight,
  formatValue,
}: {
  labels: string[];
  series: ChartSeries[];
  activeIndex: number | null;
  onIndexChange: (idx: number | null) => void;
  highlightId: string | null;
  onToggleHighlight: (id: string) => void;
  formatValue: (v: number) => string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const n = labels.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(...all, 1);

  const x = (i: number) => PAD_X + (n > 1 ? (i / (n - 1)) * (W - 2 * PAD_X) : (W - 2 * PAD_X) / 2);
  const y = (v: number) => PAD_TOP + (1 - v / max) * (H - PAD_TOP - PAD_BOTTOM);

  const path = (values: Array<number | null>) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false; // trou honnête : on lève le crayon, pas d'interpolation
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  const indexFromEvent = useCallback(
    (clientX: number): number | null => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || !n) return null;
      const rel = ((clientX - rect.left) / rect.width) * W;
      const i = Math.round(((rel - PAD_X) / (W - 2 * PAD_X)) * (n - 1));
      return Math.min(Math.max(i, 0), n - 1);
    },
    [n],
  );

  const handlePointer = (e: React.PointerEvent) => {
    onIndexChange(indexFromEvent(e.clientX));
  };

  // Densité des étiquettes X : toutes si ≤ 13, sinon 1 sur k (bornes incluses).
  const step = n <= 13 ? 1 : Math.ceil(n / 12);
  const tickIdx = labels.map((_, i) => i).filter((i) => i % step === 0 || i === n - 1);

  if (!series.length || !n) {
    return <p className="text-center text-xs text-mobile-muted py-6">Aucune donnée sur la période</p>;
  }

  return (
    <div className="bg-mobile-card rounded-2xl shadow-card p-3">
      {/* Légende nommée, toujours visible au-dessus du graphique */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {series.map((s) => {
          const dimmed = highlightId !== null && highlightId !== s.id;
          return (
            <button
              key={s.id}
              onClick={() => onToggleHighlight(s.id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold transition-opacity ${
                dimmed ? 'opacity-40' : ''
              } ${highlightId === s.id ? 'bg-mobile-subtle ring-1 ring-mobile-accent/40' : 'bg-mobile-subtle'}`}
            >
              <svg width="16" height="6" aria-hidden>
                <line
                  x1="0" y1="3" x2="16" y2="3"
                  stroke={s.color}
                  strokeWidth="2.5"
                  strokeDasharray={s.dashed ? '4 3' : undefined}
                />
              </svg>
              <span className="truncate max-w-[120px]">{s.name}</span>
            </button>
          );
        })}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        style={{ touchAction: 'none' }}
        role="img"
        aria-label="Comparaison des points de vente"
        onPointerDown={handlePointer}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse' || e.buttons > 0 || e.pointerType === 'touch') handlePointer(e);
        }}
        onPointerLeave={() => onIndexChange(null)}
      >
        {/* Grille horizontale légère */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD_X} x2={W - PAD_X}
            y1={PAD_TOP + f * (H - PAD_TOP - PAD_BOTTOM)}
            y2={PAD_TOP + f * (H - PAD_TOP - PAD_BOTTOM)}
            stroke="#eef0f4" strokeWidth="1"
          />
        ))}

        {/* Courbes */}
        {series.map((s) => {
          const dimmed = highlightId !== null && highlightId !== s.id;
          return (
            <path
              key={s.id}
              d={path(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth={highlightId === s.id ? 3 : 2}
              strokeOpacity={dimmed ? 0.18 : 1}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dashed ? '5 4' : undefined}
            />
          );
        })}

        {/* Points uniques (une seule valeur non nulle → path invisible) */}
        {series.map((s) => {
          const idxs = s.values.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0);
          if (idxs.length !== 1) return null;
          const i = idxs[0];
          return <circle key={`dot-${s.id}`} cx={x(i)} cy={y(s.values[i]!)} r="3.5" fill={s.color} />;
        })}

        {/* Crosshair + points au créneau actif */}
        {activeIndex !== null && activeIndex < n && (
          <g>
            <line
              x1={x(activeIndex)} x2={x(activeIndex)}
              y1={PAD_TOP} y2={H - PAD_BOTTOM}
              stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3"
            />
            {series.map((s) => {
              const v = s.values[activeIndex];
              if (v === null || (highlightId !== null && highlightId !== s.id)) return null;
              return (
                <circle
                  key={`x-${s.id}`}
                  cx={x(activeIndex)} cy={y(v)} r="4"
                  fill="#fff" stroke={s.color} strokeWidth="2.5"
                />
              );
            })}
          </g>
        )}

        {/* Axe X complet */}
        {tickIdx.map((i) => (
          <text
            key={i}
            x={x(i)} y={H - 6}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            fontSize="8.5"
            fill={activeIndex === i ? '#0f172a' : '#94a3b8'}
            fontWeight={activeIndex === i ? 700 : 400}
          >
            {labels[i]}
          </text>
        ))}
      </svg>

      <div className="flex justify-between text-[10px] text-mobile-muted mt-1">
        <span>max {formatValue(max)}</span>
        <span>{activeIndex === null ? 'Touchez la courbe pour lire les valeurs' : labels[activeIndex]}</span>
      </div>
    </div>
  );
}

/** Mini-graphiques par magasin — MÊME échelle pour une comparaison honnête. */
export function SmallMultiples({
  labels,
  series,
  formatValue,
}: {
  labels: string[];
  series: ChartSeries[];
  formatValue: (v: number) => string;
}) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(...all, 1);
  const w = 150;
  const h = 54;
  const x = (i: number) => (labels.length > 1 ? (i / (labels.length - 1)) * (w - 4) + 2 : w / 2);
  const y = (v: number) => 4 + (1 - v / max) * (h - 8);
  return (
    <div className="grid grid-cols-2 gap-2">
      {series.map((s) => {
        let d = '';
        let pen = false;
        s.values.forEach((v, i) => {
          if (v === null) {
            pen = false;
            return;
          }
          d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
          pen = true;
        });
        const total = s.values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
        return (
          <div key={s.id} className="bg-mobile-card rounded-xl shadow-soft p-2.5">
            <p className="text-[11px] font-semibold truncate" style={{ color: s.color }}>{s.name}</p>
            <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
              <path d={d.trim()} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
            </svg>
            <p className="text-[10px] text-mobile-muted">total {formatValue(total)} · échelle commune (max {formatValue(max)})</p>
          </div>
        );
      })}
    </div>
  );
}
