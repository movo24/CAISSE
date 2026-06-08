import React, { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Loader2, AlertCircle, Clock, Users, Save, CheckCircle2, Lock } from 'lucide-react';
import { timewinApi } from '../services/api';
import { useCurrentStoreId } from '../hooks/useCurrentStoreId';
import { useAuthStore } from '../stores/authStore';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/** Keys an opening-hours record may use, in priority order, for round-tripping the TW24 shape. */
const OPEN_KEYS = ['open', 'openTime', 'open_time', 'start'];
const CLOSE_KEYS = ['close', 'closeTime', 'close_time', 'end'];
const CLOSED_KEYS = ['closed', 'isClosed'];

function detectKey(obj: any, candidates: string[], fallback: string): string {
  for (const k of candidates) if (k in (obj || {})) return k;
  return fallback;
}

function dayLabel(s: any, i: number): string {
  if (typeof s?.day === 'string') return s.day;
  const idx = typeof s?.dayOfWeek === 'number' ? s.dayOfWeek : typeof s?.weekday === 'number' ? s.weekday : i;
  return DAYS[idx % 7];
}

const fmtTime = (v: string) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

export function PlanningPage() {
  const storeId = useCurrentStoreId();
  const role = useAuthStore((s) => s.employee?.role);
  const canEdit = role === 'admin' || role === 'manager';

  // Raw schedule items kept intact so we round-trip the exact TW24 shape on PUT.
  const [rawSchedule, setRawSchedule] = useState<any[]>([]);
  const [shifts, setShifts] = useState<{ name: string; start: string; end?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      const [schedRes, shiftRes] = await Promise.allSettled([
        timewinApi.getStoreSchedule(storeId),
        timewinApi.todayShifts(storeId),
      ]);
      if (schedRes.status === 'fulfilled') {
        const raw = schedRes.value.data;
        const list: any[] = Array.isArray(raw) ? raw : raw?.schedules || raw?.days || [];
        setRawSchedule(JSON.parse(JSON.stringify(list)));
      }
      if (shiftRes.status === 'fulfilled') {
        const raw = shiftRes.value.data;
        const list: any[] = Array.isArray(raw) ? raw : raw?.shifts || [];
        setShifts(
          list
            .map((s) => ({
              name: s?.employeeName ?? s?.employee_name ?? s?.fullName ?? 'Employé',
              start: s?.startsAt ?? s?.start ?? s?.startTime ?? s?.start_at ?? '',
              end: s?.endsAt ?? s?.end ?? s?.endTime ?? s?.end_at ?? undefined,
            }))
            .filter((s) => s.start),
        );
      }
      if (schedRes.status === 'rejected' && shiftRes.status === 'rejected') {
        setError("Le planning TimeWin24 n'est pas disponible (intégration non configurée ou hors-ligne).");
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erreur lors du chargement du planning.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const updateDay = (i: number, field: 'open' | 'close' | 'closed', value: string | boolean) => {
    setRawSchedule((prev) => {
      const next = [...prev];
      const item = { ...next[i] };
      if (field === 'open') item[detectKey(item, OPEN_KEYS, 'open')] = value;
      else if (field === 'close') item[detectKey(item, CLOSE_KEYS, 'close')] = value;
      else item[detectKey(item, CLOSED_KEYS, 'closed')] = value;
      next[i] = item;
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    if (!storeId) return;
    setSaving(true);
    setError(null);
    try {
      await timewinApi.updateStoreSchedule(storeId, rawSchedule);
      setSuccess('Horaires enregistrés');
      setDirty(false);
      setTimeout(() => setSuccess(null), 2500);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Échec de l'enregistrement (TimeWin24 indisponible ?).");
    } finally {
      setSaving(false);
    }
  };

  const readDay = (item: any) => ({
    open: item?.[detectKey(item, OPEN_KEYS, 'open')] ?? '',
    close: item?.[detectKey(item, CLOSE_KEYS, 'close')] ?? '',
    closed: !!item?.[detectKey(item, CLOSED_KEYS, 'closed')],
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <CalendarClock size={28} className="text-bo-accent" />
            Planning
          </h1>
          <p className="text-sm text-bo-muted mt-1">Horaires d'ouverture {canEdit ? '(éditable)' : '(lecture seule)'} · présences du jour · source : TimeWin24</p>
        </div>
        {canEdit && (
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-bo-accent text-white rounded-xl font-semibold text-sm hover:bg-bo-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Enregistrer
          </button>
        )}
      </div>

      {success && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} /> {success}
        </div>
      )}
      {error && (
        <div className="mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-bo-accent" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Operating hours — editable */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50 flex items-center gap-2">
              <Clock size={16} className="text-bo-accent" />
              <h2 className="font-semibold text-bo-text">Horaires d'ouverture</h2>
            </div>
            {rawSchedule.length === 0 ? (
              <p className="p-6 text-sm text-bo-muted text-center">Aucun horaire configuré.</p>
            ) : (
              <table className="w-full">
                <tbody>
                  {rawSchedule.map((item, i) => {
                    const d = readDay(item);
                    return (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="py-2.5 px-5 text-sm font-medium text-bo-text">{dayLabel(item, i)}</td>
                        {canEdit ? (
                          <td className="py-2 px-5">
                            <div className="flex items-center justify-end gap-2">
                              <label className="flex items-center gap-1.5 text-xs text-bo-muted">
                                <input type="checkbox" checked={d.closed} onChange={(e) => updateDay(i, 'closed', e.target.checked)} />
                                Fermé
                              </label>
                              <input type="time" value={d.open} disabled={d.closed} onChange={(e) => updateDay(i, 'open', e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-40" />
                              <span className="text-gray-400">–</span>
                              <input type="time" value={d.close} disabled={d.closed} onChange={(e) => updateDay(i, 'close', e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-40" />
                            </div>
                          </td>
                        ) : (
                          <td className="py-2.5 px-5 text-sm text-right">
                            {d.closed ? <span className="text-gray-400">Fermé</span> : <span>{d.open || '—'} – {d.close || '—'}</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Today's shifts — read-only */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50 flex items-center gap-2">
              <Users size={16} className="text-bo-accent" />
              <h2 className="font-semibold text-bo-text">Présences aujourd'hui</h2>
            </div>
            {shifts.length === 0 ? (
              <p className="p-6 text-sm text-bo-muted text-center">Aucun shift prévu aujourd'hui.</p>
            ) : (
              <table className="w-full">
                <tbody>
                  {shifts.map((s, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="py-2.5 px-5 text-sm font-medium text-bo-text">{s.name}</td>
                      <td className="py-2.5 px-5 text-sm text-right text-bo-muted">{fmtTime(s.start)}{s.end ? ` – ${fmtTime(s.end)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* What needs TimeWin24 upstream endpoints */}
      <div className="mt-6 bg-gray-50 border border-gray-100 rounded-2xl p-5">
        <p className="text-sm font-semibold text-bo-text flex items-center gap-2"><Lock size={14} /> Nécessite des endpoints TimeWin24 (amont)</p>
        <ul className="mt-2 text-xs text-bo-muted list-disc list-inside space-y-1">
          <li>Édition des shifts individuels (affectation employé/horaire) — pas d'endpoint TW24 (seuls les horaires d'ouverture sont éditables ici).</li>
          <li>Validation manager des plannings — endpoint TW24 absent.</li>
          <li>Échanges de shifts entre employés — endpoint TW24 absent.</li>
        </ul>
      </div>
    </div>
  );
}
