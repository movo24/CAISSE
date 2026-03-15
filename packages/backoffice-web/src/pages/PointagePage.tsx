import React, { useState, useMemo, useEffect } from 'react';
import {
  Clock, UserCheck, UserX, AlertTriangle, Coffee,
  ChevronLeft, ChevronRight, Download, Calendar,
  ArrowUpDown,
} from 'lucide-react';
import { pointageApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';

/* ── Types ── */

type PunchType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';

interface Punch {
  id: string;
  employeeId: string;
  employeeName: string;
  type: PunchType;
  timestamp: string;
  source: 'auto_login' | 'auto_logout' | 'manual';
}

interface DailySummary {
  employeeId: string;
  employeeName: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  totalMinutes: number;
  breakMinutes: number;
  netMinutes: number;
  anomalies: string[];
}

interface LiveEmployee {
  id: string;
  name: string;
  clockInAt: string;
  isOnBreak: boolean;
  durationMinutes: number;
}

const now = new Date();
const today = now.toISOString().slice(0, 10);

/* ── Helpers ── */

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtDuration = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  return `${h}h ${m.toString().padStart(2, '0')}`;
};
const punchLabel: Record<PunchType, string> = { clock_in: 'Entree', clock_out: 'Sortie', break_start: 'Debut pause', break_end: 'Fin pause' };
const punchColor: Record<PunchType, string> = {
  clock_in: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  clock_out: 'text-red-600 bg-red-50 border-red-200',
  break_start: 'text-amber-600 bg-amber-50 border-amber-200',
  break_end: 'text-blue-600 bg-blue-50 border-blue-200',
};

/* ── Component ── */

export function PointagePage() {
  const storeId = useAuthStore((s) => s.employee?.storeId) || '';
  const [selectedDate, setSelectedDate] = useState(today);
  const [sortField, setSortField] = useState<'time' | 'name'>('time');
  const [liveEmployees, setLiveEmployees] = useState<LiveEmployee[]>([]);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);

  useEffect(() => {
    if (!storeId) return;
    pointageApi.liveStatus(storeId).then((res) => {
      setLiveEmployees(res.data || []);
    }).catch(() => {});
  }, [storeId]);

  useEffect(() => {
    pointageApi.list({ date: selectedDate }).then((res) => {
      setPunches(res.data || []);
    }).catch(() => {});
    pointageApi.summary({ startDate: selectedDate, endDate: selectedDate }).then((res) => {
      setDailySummaries(res.data || []);
    }).catch(() => {});
  }, [selectedDate]);

  const filteredPunches = useMemo(() => {
    const list = punches.filter((p) => p.timestamp.slice(0, 10) === selectedDate);
    return list.sort((a, b) =>
      sortField === 'time'
        ? new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        : a.employeeName.localeCompare(b.employeeName),
    );
  }, [selectedDate, sortField, punches]);

  const filteredSummaries = useMemo(
    () => dailySummaries.filter((s) => s.date === selectedDate),
    [selectedDate, dailySummaries],
  );

  const anomalyCount = useMemo(
    () => dailySummaries.filter((s) => s.anomalies.length > 0).length,
    [dailySummaries],
  );

  const changeDate = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const handleExportCSV = () => {
    const header = 'Employe;Type;Heure;Source\n';
    const rows = filteredPunches.map((p) =>
      `${p.employeeName};${punchLabel[p.type]};${fmtTime(p.timestamp)};${p.source}`,
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pointage_${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-bo-accent/10 flex items-center justify-center">
              <Clock size={22} className="text-bo-accent" />
            </div>
            Pointage
          </h1>
          <p className="text-sm text-bo-muted mt-1">Suivi des presences, pauses et anomalies en temps reel.</p>
        </div>
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-bo-accent text-white font-semibold text-sm hover:bg-bo-accent/90 transition-all shadow-lg shadow-bo-accent/25"
        >
          <Download size={16} /> Exporter CSV
        </button>
      </div>

      {/* ═══ SECTION 1 : En poste actuellement ═══ */}
      <div className="bg-white rounded-2xl border border-bo-border/30 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-bo-border/20 bg-emerald-50/30 flex items-center justify-between">
          <h2 className="text-sm font-bold text-bo-text flex items-center gap-2">
            <UserCheck size={16} className="text-emerald-600" />
            En poste actuellement
            <span className="ml-1 text-[10px] font-bold text-white bg-emerald-500 px-2 py-0.5 rounded-full">{liveEmployees.length}</span>
          </h2>
        </div>
        <div className="p-4 grid grid-cols-3 gap-3">
          {liveEmployees.map((emp) => (
            <div key={emp.id} className={`p-4 rounded-xl border ${emp.isOnBreak ? 'bg-amber-50/50 border-amber-200' : 'bg-emerald-50/30 border-emerald-200/60'}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-bo-accent/20 to-indigo-100 flex items-center justify-center">
                  <span className="text-xs font-bold text-bo-accent">{emp.name.split(' ').map((w) => w[0]).join('')}</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-bo-text">{emp.name}</p>
                  <p className="text-[10px] text-bo-muted">Arrivee {fmtTime(emp.clockInAt)}</p>
                </div>
                {emp.isOnBreak && (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200">
                    <Coffee size={9} /> Pause
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-bo-muted">Duree</span>
                <span className="text-sm font-bold text-emerald-700">{fmtDuration(emp.durationMinutes)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ SECTION 2 : Historique du jour ═══ */}
      <div className="bg-white rounded-2xl border border-bo-border/30 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-bo-border/20 bg-bo-subtle/30 flex items-center justify-between">
          <h2 className="text-sm font-bold text-bo-text flex items-center gap-2">
            <Calendar size={16} className="text-bo-accent" />
            Historique
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => changeDate(-1)} className="p-1.5 rounded-lg hover:bg-bo-subtle transition-colors"><ChevronLeft size={16} className="text-bo-muted" /></button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs font-semibold text-bo-text bg-transparent border border-bo-border/30 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-bo-accent/30 outline-none"
            />
            <button onClick={() => changeDate(1)} className="p-1.5 rounded-lg hover:bg-bo-subtle transition-colors"><ChevronRight size={16} className="text-bo-muted" /></button>
            <button
              onClick={() => setSortField(sortField === 'time' ? 'name' : 'time')}
              className="flex items-center gap-1 text-[10px] font-semibold text-bo-muted hover:text-bo-text px-2 py-1 rounded-lg hover:bg-bo-subtle transition-colors"
            >
              <ArrowUpDown size={11} />
              {sortField === 'time' ? 'Par heure' : 'Par nom'}
            </button>
          </div>
        </div>

        {filteredPunches.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <UserX size={32} className="mx-auto text-bo-muted/30 mb-2" />
            <p className="text-sm text-bo-muted">Aucun pointage pour cette date</p>
          </div>
        ) : (
          <div className="divide-y divide-bo-border/10">
            {filteredPunches.map((p) => (
              <div key={p.id} className="px-6 py-2.5 flex items-center gap-4 hover:bg-bo-subtle/20 transition-colors">
                <span className="text-xs font-mono font-semibold text-bo-text w-12">{fmtTime(p.timestamp)}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${punchColor[p.type]}`}>
                  {punchLabel[p.type]}
                </span>
                <span className="text-sm font-medium text-bo-text flex-1">{p.employeeName}</span>
                <span className="text-[10px] text-bo-muted capitalize">{p.source.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ SECTION 3 : Resume journalier ═══ */}
      {filteredSummaries.length > 0 && (
        <div className="bg-white rounded-2xl border border-bo-border/30 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-bo-border/20 bg-bo-subtle/30">
            <h2 className="text-sm font-bold text-bo-text">Resume journalier — {selectedDate}</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-bo-border/20">
                <th className="text-left px-6 py-2.5 text-[10px] font-bold text-bo-muted uppercase tracking-wider">Employe</th>
                <th className="text-center px-3 py-2.5 text-[10px] font-bold text-bo-muted uppercase tracking-wider">Entree</th>
                <th className="text-center px-3 py-2.5 text-[10px] font-bold text-bo-muted uppercase tracking-wider">Sortie</th>
                <th className="text-center px-3 py-2.5 text-[10px] font-bold text-bo-muted uppercase tracking-wider">Pause</th>
                <th className="text-center px-3 py-2.5 text-[10px] font-bold text-bo-muted uppercase tracking-wider">Travail net</th>
                <th className="text-center px-3 py-2.5 text-[10px] font-bold text-bo-muted uppercase tracking-wider">Anomalie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bo-border/10">
              {filteredSummaries.map((s) => (
                <tr key={s.employeeId} className="hover:bg-bo-subtle/20">
                  <td className="px-6 py-3 text-sm font-semibold text-bo-text">{s.employeeName}</td>
                  <td className="text-center px-3 py-3 text-xs font-mono text-bo-text">{s.clockIn ? fmtTime(s.clockIn) : '—'}</td>
                  <td className="text-center px-3 py-3 text-xs font-mono text-bo-text">{s.clockOut ? fmtTime(s.clockOut) : <span className="text-red-500 font-bold">MANQUANT</span>}</td>
                  <td className="text-center px-3 py-3 text-xs text-amber-600 font-semibold">{s.breakMinutes > 0 ? fmtDuration(s.breakMinutes) : '—'}</td>
                  <td className="text-center px-3 py-3 text-xs font-bold text-emerald-700">{s.netMinutes > 0 ? fmtDuration(s.netMinutes) : '—'}</td>
                  <td className="text-center px-3 py-3">
                    {s.anomalies.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                        <AlertTriangle size={10} /> {s.anomalies[0]}
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-500 font-medium">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ SECTION 4 : Anomalies globales ═══ */}
      {anomalyCount > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-100">
          <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-red-800">{anomalyCount} anomalie{anomalyCount > 1 ? 's' : ''} detectee{anomalyCount > 1 ? 's' : ''}</p>
            <ul className="text-[11px] text-red-600 mt-1 space-y-0.5">
              {dailySummaries
                .filter((s) => s.anomalies.length > 0)
                .map((s) => (
                  <li key={s.employeeId}>
                    <strong>{s.employeeName}</strong> — {s.anomalies.join(', ')} ({s.date})
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
