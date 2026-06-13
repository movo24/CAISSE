import { cockpitApi } from '../api';
import { freshnessLabel } from '../format';
import { useCockpitFetch } from '../useCockpitFetch';

const STATUS_LABEL: Record<string, string> = {
  rendered: 'Brief généré',
  fallback: 'Brief (modèle de secours)',
  awaiting_first_beat: 'Premier brief de la journée à venir',
  no_data: 'Pas encore de données aujourd’hui',
  rejected: 'Brief indisponible',
};

export function BriefView() {
  const { data, error, loading, refresh } = useCockpitFetch(() => cockpitApi.brief());

  if (loading) return <p className="p-4 text-sm text-mobile-muted">Chargement…</p>;
  if (error || !data) return (
    <div className="p-4 text-sm">
      <p>{error ?? 'Brief indisponible.'}</p>
      <button className="mt-2 text-mobile-accent font-semibold" onClick={refresh}>Réessayer</button>
    </div>
  );

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-mobile-muted font-semibold uppercase">{STATUS_LABEL[data.status] ?? data.status}</span>
        <span className="text-[11px] text-mobile-muted">
          {data.businessDay}{data.beat != null ? ` · beat ${data.beat}h` : ''}
        </span>
      </div>
      {data.text ? (
        <div className="bg-white rounded-xl border border-mobile-border/60 p-4">
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{data.text}</p>
          <p className="text-[11px] text-mobile-muted mt-3">données {freshnessLabel(data.computedAt)}</p>
        </div>
      ) : (
        <p className="text-sm text-mobile-muted">
          {data.status === 'awaiting_first_beat'
            ? 'Le brief du matin sera généré au premier beat de la journée.'
            : 'Rien à raconter pour le moment.'}
        </p>
      )}
    </div>
  );
}
