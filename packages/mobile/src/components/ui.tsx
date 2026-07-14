// ── UI partagée du centre de pilotage (lecture seule) ────────────
// Cartes stats, badges d'évolution, états chargement/erreur/absence.
// Règles : grands chiffres lisibles, hiérarchie nette, aucune donnée
// inventée (null → « Donnée indisponible »), erreurs jamais avalées.
// ─────────────────────────────────────────────────────────────────

import { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus, WifiOff, RefreshCw } from 'lucide-react';
import { formatPct, formatSince, trendOf, UNAVAILABLE } from '../lib/format';

// ── En-tête de page : titre à gauche, LOGO officiel en haut à droite ──
// Le logo est le fichier réel du projet (public/icons/app-icon.png),
// proportions conservées, taille fixe — identique sur tous les écrans.
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-mobile-border/60 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-bold text-mobile-text truncate">{title}</h1>
        {subtitle && <p className="text-xs text-mobile-muted truncate">{subtitle}</p>}
      </div>
      {right}
      <img
        src="/icons/app-icon.png"
        alt="Logo"
        className="h-9 w-9 rounded-xl object-contain shrink-0"
      />
    </div>
  );
}

/** Bandeau « dernière synchronisation » (+ mode hors ligne). */
export function SyncBadge({ syncedAt, fromCache, onReload, loading }: {
  syncedAt: string | null;
  fromCache: boolean;
  onReload: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-[11px] text-mobile-muted px-1">
      <span className="flex items-center gap-1.5">
        {fromCache && <WifiOff size={12} className="text-mobile-warning" />}
        {fromCache ? 'Hors ligne — ' : ''}Synchronisé {formatSince(syncedAt)}
      </span>
      <button
        onClick={onReload}
        disabled={loading}
        aria-label="Actualiser"
        className="p-1.5 -mr-1 rounded-lg active:bg-mobile-subtle"
      >
        <RefreshCw size={13} className={loading ? 'animate-spin text-mobile-border' : ''} />
      </button>
    </div>
  );
}

/** Évolution signée : vert ↑ / rouge ↓ / neutre — lisible d'un coup d'œil. */
export function DeltaBadge({ pct, className = '' }: { pct: number | null | undefined; className?: string }) {
  const trend = trendOf(pct);
  const styles: Record<string, string> = {
    up: 'bg-emerald-50 text-emerald-700',
    down: 'bg-red-50 text-red-600',
    flat: 'bg-mobile-subtle text-mobile-muted',
    none: 'bg-mobile-subtle text-mobile-muted',
  };
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${styles[trend]} ${className}`}>
      <Icon size={11} strokeWidth={2.5} />
      {formatPct(pct)}
    </span>
  );
}

/** Carte statistique : grand chiffre + libellé + évolution optionnelle. */
export function KpiCard({ label, value, delta, hint, big }: {
  label: string;
  value: string;
  delta?: number | null;
  hint?: string;
  big?: boolean;
}) {
  const unavailable = value === UNAVAILABLE;
  return (
    <div className="bg-mobile-card rounded-2xl shadow-card p-3.5 flex flex-col gap-1 min-w-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-mobile-muted truncate">{label}</span>
      <span className={`font-bold text-mobile-text tabular-nums leading-tight ${unavailable ? 'text-sm text-mobile-muted font-medium' : big ? 'text-[26px]' : 'text-lg'}`}>
        {value}
      </span>
      <div className="flex items-center gap-2 min-h-[18px]">
        {delta !== undefined && <DeltaBadge pct={delta} />}
        {hint && <span className="text-[10px] text-mobile-muted truncate">{hint}</span>}
      </div>
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[13px] font-bold text-mobile-text uppercase tracking-wide">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** État de chargement propre (squelettes, pas de spinner plein écran). */
export function LoadingCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3" aria-label="Chargement">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-mobile-card rounded-2xl shadow-card p-3.5 space-y-2 animate-pulse-soft">
          <div className="h-2.5 w-16 bg-mobile-subtle rounded" />
          <div className="h-6 w-24 bg-mobile-subtle rounded" />
          <div className="h-3 w-12 bg-mobile-subtle rounded" />
        </div>
      ))}
    </div>
  );
}

/** Erreur précise + réessayer — jamais avalée, jamais remplacée par du faux. */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div data-testid="page-error" className="p-3 rounded-xl bg-red-50 text-red-600 text-sm flex items-center justify-between gap-3">
      <span className="min-w-0">{message}</span>
      <button onClick={onRetry} className="font-semibold underline shrink-0">Réessayer</button>
    </div>
  );
}

export function Unavailable({ label }: { label?: string }) {
  return (
    <p className="text-center text-sm text-mobile-muted py-6">
      {label ?? UNAVAILABLE}
    </p>
  );
}

/** Boutons segmentés (filtres rapides, tri). */
export function Segmented<T extends string>({ options, value, onChange }: {
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            value === o.key
              ? 'bg-mobile-accent text-white'
              : 'bg-mobile-card text-mobile-muted shadow-soft'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
