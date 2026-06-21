import { useState, useEffect, useCallback } from 'react';
import {
  Ticket, Plus, X, Loader2, CheckCircle2, Ban, History, Percent, Euro,
} from 'lucide-react';
import { promoCodesApi } from '../services/api';

interface PromoCode {
  id: string;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
}

interface Redemption {
  employeeId: string;
  saleId: string;
  discountAppliedMinorUnits: number;
  appliedAt: string;
}

const eur = (c: number) => (c / 100).toFixed(2) + ' €';

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('fr-FR') : '—';

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const fmtValue = (p: PromoCode) =>
  p.discountType === 'percentage' ? `${p.discountValue} %` : eur(p.discountValue);

export function PromoCodesPage() {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create form
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [maxUses, setMaxUses] = useState('');

  // Per-row deactivation
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  // History modal
  const [historyCode, setHistoryCode] = useState<PromoCode | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await promoCodesApi.list();
      setCodes(res.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const resetForm = () => {
    setCode('');
    setDiscountType('percentage');
    setDiscountValue('');
    setStartsAt('');
    setEndsAt('');
    setMaxUses('');
  };

  const submit = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError('Le code est requis.');
      return;
    }
    const raw = parseFloat(discountValue.replace(',', '.'));
    if (!Number.isFinite(raw) || raw <= 0) {
      setError('Valeur de remise invalide.');
      return;
    }
    if (discountType === 'percentage' && (raw < 0 || raw > 100)) {
      setError('Le pourcentage doit être entre 0 et 100.');
      return;
    }
    const value =
      discountType === 'percentage' ? Math.round(raw) : Math.round(raw * 100);

    let parsedMax: number | undefined;
    if (maxUses.trim()) {
      const m = parseInt(maxUses, 10);
      if (!Number.isFinite(m) || m <= 0) {
        setError('Nombre maximum d’utilisations invalide.');
        return;
      }
      parsedMax = m;
    }

    setSubmitting(true);
    setError(null);
    try {
      await promoCodesApi.create({
        code: trimmed,
        discountType,
        discountValue: value,
        startsAt: startsAt || undefined,
        endsAt: endsAt || undefined,
        maxUses: parsedMax,
      });
      flashSuccess(`Code ${trimmed} créé`);
      setFormOpen(false);
      resetForm();
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const deactivate = async (p: PromoCode) => {
    setDeactivatingId(p.id);
    setError(null);
    try {
      await promoCodesApi.deactivate(p.id);
      flashSuccess(`Code ${p.code} désactivé`);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setDeactivatingId(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-bo-text flex items-center gap-2">
          <Ticket size={22} className="text-bo-accent" />
          Codes promo
        </h1>
        <button
          onClick={() => {
            setFormOpen((o) => !o);
            setError(null);
          }}
          className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 flex items-center gap-1.5"
        >
          {formOpen ? <X size={15} /> : <Plus size={15} />}
          {formOpen ? 'Fermer' : 'Code'}
        </button>
      </div>

      {success && (
        <div className="mb-4 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={15} /> {success}
        </div>
      )}
      {error && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {formOpen && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
          <h2 className="text-sm font-bold text-bo-text mb-3">Nouveau code promo</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-bo-text mb-1">Code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ETE2026"
                className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-bo-text mb-1">Type de remise</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'percentage' | 'fixed')}
                className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm"
              >
                <option value="percentage">Pourcentage (%)</option>
                <option value="fixed">Montant fixe (€)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-bo-text mb-1">
                {discountType === 'percentage' ? 'Pourcentage (0-100)' : 'Montant (€)'}
              </label>
              <input
                type="number"
                min={0}
                max={discountType === 'percentage' ? 100 : undefined}
                step={discountType === 'percentage' ? 1 : 0.01}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === 'percentage' ? '10' : '5.00'}
                className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-bo-text mb-1">
                Utilisations max (optionnel)
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="Illimité"
                className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-bo-text mb-1">Début (optionnel)</label>
              <input
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-bo-text mb-1">Fin (optionnel)</label>
              <input
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full px-2 py-1 rounded-lg border border-gray-200 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => {
                setFormOpen(false);
                resetForm();
                setError(null);
              }}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-bo-muted hover:bg-gray-50"
            >
              Annuler
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Créer
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-bo-accent" />
        </div>
      ) : codes.length === 0 ? (
        <div className="text-center py-20 text-bo-muted">
          <Ticket size={44} className="mx-auto mb-3 opacity-30" />
          <p className="text-base font-semibold">Aucun code promo</p>
          <p className="text-sm mt-1">Créez votre premier code avec « + Code ».</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="py-2.5 px-4 text-xs font-semibold text-bo-muted uppercase tracking-wider">Code</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-bo-muted uppercase tracking-wider">Remise</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-bo-muted uppercase tracking-wider">Validité</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-bo-muted uppercase tracking-wider text-center">Utilisations</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-bo-muted uppercase tracking-wider">Statut</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((p) => {
                const exhausted = p.maxUses != null && p.usedCount >= p.maxUses;
                return (
                  <tr key={p.id} className="border-t border-gray-50 hover:bg-gray-50/40">
                    <td className="py-2.5 px-4 font-mono text-sm font-semibold text-bo-text">{p.code}</td>
                    <td className="py-2.5 px-4 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        {p.discountType === 'percentage' ? (
                          <Percent size={13} className="text-bo-muted" />
                        ) : (
                          <Euro size={13} className="text-bo-muted" />
                        )}
                        {fmtValue(p)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-sm text-bo-muted">
                      {fmtDate(p.startsAt)} → {fmtDate(p.endsAt)}
                    </td>
                    <td className="py-2.5 px-4 text-sm text-center">
                      <span className={exhausted ? 'font-semibold text-amber-600' : 'text-bo-text'}>
                        {p.usedCount}
                        {p.maxUses != null ? ` / ${p.maxUses}` : ' / ∞'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      {p.isActive ? (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-emerald-50 text-emerald-600">
                          Actif
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-gray-100 text-gray-500">
                          Désactivé
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setHistoryCode(p)}
                          className="px-2 py-1 rounded-lg border border-gray-200 text-xs font-semibold text-bo-muted hover:bg-gray-50 flex items-center gap-1"
                        >
                          <History size={13} /> Historique
                        </button>
                        {p.isActive && (
                          <button
                            onClick={() => deactivate(p)}
                            disabled={deactivatingId === p.id}
                            className="px-2 py-1 rounded-lg border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 flex items-center gap-1"
                          >
                            {deactivatingId === p.id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Ban size={13} />
                            )}
                            Désactiver
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {historyCode && (
        <HistoryModal promo={historyCode} onClose={() => setHistoryCode(null)} />
      )}
    </div>
  );
}

function HistoryModal({ promo, onClose }: { promo: PromoCode; onClose: () => void }) {
  const [rows, setRows] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await promoCodesApi.history(promo.id);
        if (active) setRows(res.data || []);
      } catch (e: any) {
        if (active) setErr(e?.response?.data?.message || 'Erreur');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [promo.id]);

  const total = rows.reduce((s, r) => s + r.discountAppliedMinorUnits, 0);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="w-full max-w-lg bg-white rounded-xl border border-gray-100 max-h-[85vh] overflow-auto">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-base font-bold text-bo-text flex items-center gap-2">
            <History size={17} className="text-bo-accent" />
            Historique · <span className="font-mono">{promo.code}</span>
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X size={18} className="text-bo-muted" />
          </button>
        </div>

        <div className="px-5 py-4">
          {err && (
            <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {err}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={26} className="animate-spin text-bo-accent" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-bo-muted text-center py-8">
              Aucune utilisation enregistrée pour ce code.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3 text-sm">
                <span className="text-bo-muted">
                  {rows.length} utilisation{rows.length > 1 ? 's' : ''}
                </span>
                <span className="font-semibold text-bo-text">
                  Total remisé : {eur(total)}
                </span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="py-2 px-3 text-xs font-semibold text-bo-muted uppercase tracking-wider">Date</th>
                    <th className="py-2 px-3 text-xs font-semibold text-bo-muted uppercase tracking-wider">Vente</th>
                    <th className="py-2 px-3 text-xs font-semibold text-bo-muted uppercase tracking-wider">Employé</th>
                    <th className="py-2 px-3 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">Remise</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.saleId}-${i}`} className="border-t border-gray-50">
                      <td className="py-2 px-3 text-sm text-bo-muted">{fmtDateTime(r.appliedAt)}</td>
                      <td className="py-2 px-3 text-sm font-mono text-bo-text">{r.saleId}</td>
                      <td className="py-2 px-3 text-sm font-mono text-bo-muted">{r.employeeId}</td>
                      <td className="py-2 px-3 text-sm text-right font-semibold">
                        {eur(r.discountAppliedMinorUnits)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
