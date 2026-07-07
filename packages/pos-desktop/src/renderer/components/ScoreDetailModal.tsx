import { useEffect, useState } from 'react';
import { X, Loader2, ClipboardList } from 'lucide-react';
import { employeeScoreApi } from '../services/api';

/**
 * Détail Score Système — wording strictement factuel (mission §8).
 * Jamais « mauvais employé / pas sérieux » ; uniquement « points à corriger /
 * événements détectés / actions à vérifier ».
 */

interface CategoryScore { score: number; max: number; label: string }
interface DayBreakdown {
  total: number;
  color: string;
  categories: Record<string, CategoryScore>;
}
interface RecentEvent {
  eventType: string;
  category: string;
  severity: string;
  pointsDelta: number;
  reason: string | null;
  createdAt: string;
}
interface Detail {
  day: DayBreakdown;
  recentEvents: RecentEvent[];
}

const CATEGORY_ORDER = ['session', 'cash', 'procedure', 'inventory', 'schedule', 'regularity'];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Libellé factuel court par type d'événement (miroir des règles backend). */
const EVENT_LABELS: Record<string, string> = {
  SESSION_ABANDONED: 'Session non fermée / abandonnée',
  SESSION_FORCE_CLOSED_BY_MANAGER: 'Session oubliée fermée par un responsable',
  ACTION_WITHOUT_VALID_SESSION: 'Action sans session valide',
  CASH_DIFFERENCE_MINOR: 'Écart caisse mineur',
  CASH_DIFFERENCE_MAJOR: 'Écart caisse majeur',
  CASH_DIFFERENCE_CRITICAL: 'Écart caisse critique',
  VOID_WITHOUT_REASON: 'Annulation sans motif',
  VOID_RATE_ABNORMAL: "Taux d'annulation anormal",
  REFUND_WITHOUT_REASON: 'Remboursement sans motif',
  CASH_DRAWER_OPENED_MANUALLY: 'Ouverture tiroir manuelle',
  DISCOUNT_WITHOUT_AUTHORIZATION: 'Remise sans autorisation',
  DISCOUNT_ABOVE_LIMIT: 'Remise au-dessus du plafond',
  PRICE_OVERRIDE_WITHOUT_REASON: 'Prix forcé sans motif',
  STOCK_CORRECTION_WITHOUT_REASON: 'Correction stock sans motif',
  LOW_STOCK_IGNORED: 'Alerte stock ignorée',
  PRODUCT_DUPLICATE_ATTEMPT: 'Tentative de doublon produit',
  EMPLOYEE_LOGIN_OUTSIDE_SCHEDULE: 'Connexion hors planning',
  EMPLOYEE_SESSION_OPEN_AFTER_SHIFT_END: 'Session ouverte après fin de shift',
};

export function ScoreDetailModal({ onClose }: { onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    employeeScoreApi
      .myDetail()
      .then((res) => { if (alive) setDetail(res.data); })
      .catch(() => { if (alive) setDetail(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-elevated w-[460px] max-w-[92vw] max-h-[88vh] overflow-y-auto p-6 space-y-5 animate-scale-in">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-pos-accent" />
            <h3 className="font-bold text-lg text-pos-text">Détail Score Système</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32"><Loader2 size={24} className="animate-spin text-pos-accent" /></div>
        ) : !detail ? (
          <p className="text-sm text-pos-muted text-center py-8">Score indisponible pour le moment.</p>
        ) : (
          <>
            <div className="rounded-2xl bg-pos-subtle p-4 text-center">
              <p className="text-xs text-pos-muted uppercase tracking-wider">Score du jour</p>
              <p className="text-4xl font-black text-pos-text">{detail.day.total}<span className="text-lg text-pos-muted">/100</span></p>
            </div>

            <div className="space-y-2">
              {CATEGORY_ORDER.filter((k) => detail.day.categories[k]).map((k) => {
                const c = detail.day.categories[k];
                const pct = c.max > 0 ? (c.score / c.max) * 100 : 0;
                return (
                  <div key={k}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-pos-muted">{c.label}</span>
                      <span className="font-semibold text-pos-text">{c.score}/{c.max}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 85 ? 'bg-emerald-400' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <p className="text-xs font-semibold text-pos-muted uppercase tracking-wider mb-2">Événements détectés</p>
              {detail.recentEvents.filter((e) => e.pointsDelta < 0).length === 0 ? (
                <p className="text-sm text-emerald-600">Aucun point à corriger récemment. 🟢</p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.recentEvents.filter((e) => e.pointsDelta < 0).slice(0, 8).map((e, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-red-400 mt-0.5">•</span>
                      <div>
                        <span className="text-pos-text">{EVENT_LABELS[e.eventType] || e.eventType}</span>
                        {e.reason && <span className="text-pos-muted"> — {e.reason}</span>}
                        <span className="text-[10px] text-pos-muted block">{fmtDate(e.createdAt)} · {e.pointsDelta} pts</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-[10px] text-pos-muted">
              Score 100 % basé sur des faits objectifs et vérifiables (session, caisse, procédures, stock, planning).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
