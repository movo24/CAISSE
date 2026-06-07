import React, { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Loader2, AlertCircle, Clock, Users } from 'lucide-react';
import { timewinApi } from '../services/api';
import { useCurrentStoreId } from '../hooks/useCurrentStoreId';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

interface DaySchedule {
  day: string;
  open: string | null;
  close: string | null;
  closed: boolean;
}

function normalizeSchedule(raw: any): DaySchedule[] {
  const list: any[] = Array.isArray(raw) ? raw : raw?.schedules || raw?.days || [];
  if (list.length === 0) return [];
  return list.map((s, i) => {
    const dayLabel =
      typeof s?.day === 'string'
        ? s.day
        : DAYS[(typeof s?.dayOfWeek === 'number' ? s.dayOfWeek : typeof s?.weekday === 'number' ? s.weekday : i) % 7];
    const open = s?.open ?? s?.openTime ?? s?.open_time ?? s?.start ?? null;
    const close = s?.close ?? s?.closeTime ?? s?.close_time ?? s?.end ?? null;
    const closed = s?.closed ?? s?.isClosed ?? (!open && !close);
    return { day: dayLabel, open, close, closed: !!closed };
  });
}

function normalizeShifts(raw: any): { name: string; start: string; end?: string }[] {
  const list: any[] = Array.isArray(raw) ? raw : raw?.shifts || [];
  return list
    .map((s) => ({
      name: s?.employeeName ?? s?.employee_name ?? s?.fullName ?? 'Employé',
      start: s?.startsAt ?? s?.start ?? s?.startTime ?? s?.start_at ?? '',
      end: s?.endsAt ?? s?.end ?? s?.endTime ?? s?.end_at ?? undefined,
    }))
    .filter((s) => s.start);
}

const fmtTime = (v: string) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

export function PlanningPage() {
  const storeId = useCurrentStoreId();
  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [shifts, setShifts] = useState<{ name: string; start: string; end?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      const [schedRes, shiftRes] = await Promise.allSettled([
        timewinApi.getStoreSchedule(storeId),
        timewinApi.todayShifts(storeId),
      ]);
      if (schedRes.status === 'fulfilled') setSchedule(normalizeSchedule(schedRes.value.data));
      if (shiftRes.status === 'fulfilled') setShifts(normalizeShifts(shiftRes.value.data));
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

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
          <CalendarClock size={28} className="text-bo-accent" />
          Planning
        </h1>
        <p className="text-sm text-bo-muted mt-1">
          Horaires d'ouverture et présences du jour (lecture seule · source : TimeWin24)
        </p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-bo-accent" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Operating hours */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50 flex items-center gap-2">
              <Clock size={16} className="text-bo-accent" />
              <h2 className="font-semibold text-bo-text">Horaires d'ouverture</h2>
            </div>
            {schedule.length === 0 ? (
              <p className="p-6 text-sm text-bo-muted text-center">Aucun horaire configuré.</p>
            ) : (
              <table className="w-full">
                <tbody>
                  {schedule.map((d, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="py-2.5 px-5 text-sm font-medium text-bo-text">{d.day}</td>
                      <td className="py-2.5 px-5 text-sm text-right">
                        {d.closed ? (
                          <span className="text-gray-400">Fermé</span>
                        ) : (
                          <span className="text-bo-text">{d.open ?? '—'} – {d.close ?? '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Today's shifts */}
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
                      <td className="py-2.5 px-5 text-sm text-right text-bo-muted">
                        {fmtTime(s.start)}{s.end ? ` – ${fmtTime(s.end)}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-bo-muted">
        L'édition du planning, les échanges de shifts et la validation manager se font dans TimeWin24.
      </p>
    </div>
  );
}
