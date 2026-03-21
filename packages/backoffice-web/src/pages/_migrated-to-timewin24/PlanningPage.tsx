import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar, Clock, ChevronLeft, ChevronRight, Plus, Copy, Download,
  Trash2, Edit3, Save, X, Users, Sun, Moon, Coffee,
  AlertTriangle, CheckCircle2, BarChart3,
} from 'lucide-react';
import { employeesApi, planningApi } from '../services/api';

/* ═══════════════════════════════════════════════════════════════
   PLANNING PAGE — Backoffice
   Grille semaine, CRUD shifts, copie semaine précédente
   ═══════════════════════════════════════════════════════════════ */

// ── Types ──

interface ShiftEntry {
  id: string;
  employeeId: string;
  date: string;         // YYYY-MM-DD
  startTime: string;    // HH:mm
  endTime: string;      // HH:mm
  breakMinutes: number;
  type: 'regular' | 'overtime' | 'holiday' | 'training';
  notes: string;
}

interface Employee {
  id: string;
  name: string;
  role: string;
  avatar: string;
  contractHours: number; // heures hebdo contrat
}

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAYS_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function getWeekDates(offset: number): { dates: string[]; label: string; monday: Date } {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday + offset * 7);
  monday.setHours(0, 0, 0, 0);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => `${d.getDate()} ${['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
  const label = `${fmt(monday)} — ${fmt(sunday)} ${sunday.getFullYear()}`;

  return { dates, label, monday };
}

// ── Helpers ──

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function shiftDurationHours(s: ShiftEntry): number {
  const total = timeToMinutes(s.endTime) - timeToMinutes(s.startTime) - s.breakMinutes;
  return Math.max(0, total / 60);
}

function employeeWeekHours(shifts: ShiftEntry[], empId: string): number {
  return shifts
    .filter((s) => s.employeeId === empId)
    .reduce((sum, s) => sum + shiftDurationHours(s), 0);
}

const typeColors: Record<string, string> = {
  regular: 'bg-bo-accent/10 text-bo-accent border-bo-accent/20',
  overtime: 'bg-orange-50 text-orange-700 border-orange-200',
  holiday: 'bg-green-50 text-green-700 border-green-200',
  training: 'bg-purple-50 text-purple-700 border-purple-200',
};

// ── Component ──

export function PlanningPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [editingShift, setEditingShift] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const { dates, label, monday } = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const [shifts, setShifts] = useState<ShiftEntry[]>([]);

  useEffect(() => {
    employeesApi.list().then((res) => {
      const emps: any[] = res.data || [];
      setEmployees(emps.map((e: any) => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`,
        role: e.role || 'Caissier',
        avatar: `${(e.firstName || '')[0] || ''}${(e.lastName || '')[0] || ''}`,
        contractHours: 35,
      })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (dates.length > 0) {
      planningApi.getWeek({ weekStart: dates[0] }).then((res) => {
        setShifts(res.data?.shifts || []);
      }).catch(() => {});
    }
  }, [dates]);

  const weekShifts = useMemo(() => shifts, [shifts]);

  // Coverage stats per day
  const dayCoverage = useMemo(() => {
    return dates.map((d) => {
      const dayShifts = weekShifts.filter((s) => s.date === d);
      const totalHours = dayShifts.reduce((sum, s) => sum + shiftDurationHours(s), 0);
      const headcount = dayShifts.length;
      return { date: d, totalHours: Math.round(totalHours * 10) / 10, headcount };
    });
  }, [dates, weekShifts]);

  const totalWeekHours = useMemo(
    () => Math.round(weekShifts.reduce((sum, s) => sum + shiftDurationHours(s), 0) * 10) / 10,
    [weekShifts],
  );

  const isToday = (d: string) => d === new Date().toISOString().slice(0, 10);

  return (
    <div className="p-8 space-y-6 bg-gray-50/50 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-bo-accent to-purple-600 flex items-center justify-center">
              <Calendar size={20} className="text-white" />
            </div>
            Planning Equipe
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Gestion des creneaux de travail hebdomadaires
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Copy previous week */}
          <button className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <Copy size={14} />
            Copier sem. precedente
          </button>

          {/* Export */}
          <button className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <Download size={14} />
            Exporter
          </button>

          {/* Add shift */}
          <button className="flex items-center gap-2 bg-bo-accent text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-bo-accent/90 transition-colors">
            <Plus size={14} />
            Ajouter creneau
          </button>
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 px-6 py-3">
        <button
          onClick={() => setWeekOffset((o) => o - 1)}
          className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
        >
          <ChevronLeft size={18} className="text-gray-600" />
        </button>

        <div className="text-center">
          <p className="text-base font-bold text-gray-900">{label}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {totalWeekHours}h planifiees — {weekShifts.length} creneaux — {employees.length} employes
          </p>
        </div>

        <div className="flex items-center gap-2">
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="text-xs font-medium text-bo-accent hover:underline mr-2"
            >
              Aujourd'hui
            </button>
          )}
          <button
            onClick={() => setWeekOffset((o) => o + 1)}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <ChevronRight size={18} className="text-gray-600" />
          </button>
        </div>
      </div>

      {/* Planning Grid */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {/* Grid header */}
        <div className="grid grid-cols-8 border-b border-gray-100">
          {/* Employee column header */}
          <div className="px-4 py-3 bg-gray-50/50 border-r border-gray-100">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Users size={12} />
              Employe
            </span>
          </div>
          {/* Day headers */}
          {dates.map((d, idx) => {
            const dayNum = new Date(d).getDate();
            const today = isToday(d);
            const coverage = dayCoverage[idx];
            return (
              <div
                key={d}
                className={`px-3 py-3 text-center border-r border-gray-100 last:border-r-0 ${
                  today ? 'bg-bo-accent/5' : 'bg-gray-50/50'
                }`}
              >
                <p className={`text-xs font-bold ${today ? 'text-bo-accent' : 'text-gray-700'}`}>
                  {DAYS[idx]}
                </p>
                <p className={`text-[10px] mt-0.5 ${today ? 'text-bo-accent/70' : 'text-gray-400'}`}>
                  {dayNum}
                </p>
                <div className="flex items-center justify-center gap-2 mt-1">
                  <span className="text-[9px] text-gray-400">{coverage.headcount} pers.</span>
                  <span className="text-[9px] text-gray-400">{coverage.totalHours}h</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Employee rows */}
        {employees.map((emp) => {
          const weekH = Math.round(employeeWeekHours(weekShifts, emp.id) * 10) / 10;
          const isOverContract = weekH > emp.contractHours;
          const isUnderContract = weekH < emp.contractHours - 2;

          return (
            <div key={emp.id} className="grid grid-cols-8 border-b border-gray-50 last:border-b-0 hover:bg-gray-50/30 transition-colors">
              {/* Employee info */}
              <div className="px-4 py-3 border-r border-gray-100 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-bo-accent/20 to-purple-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-bo-accent">{emp.avatar}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{emp.name}</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400">{emp.role}</span>
                    <span className="text-[9px] text-gray-300">•</span>
                    <span className={`text-[10px] font-bold ${
                      isOverContract ? 'text-orange-600' : isUnderContract ? 'text-amber-600' : 'text-emerald-600'
                    }`}>
                      {weekH}h/{emp.contractHours}h
                    </span>
                    {isOverContract && <AlertTriangle size={9} className="text-orange-500" />}
                  </div>
                </div>
              </div>

              {/* Day cells */}
              {dates.map((d, idx) => {
                const dayShift = weekShifts.find((s) => s.employeeId === emp.id && s.date === d);
                const today = isToday(d);

                return (
                  <div
                    key={d}
                    className={`px-2 py-2 border-r border-gray-100 last:border-r-0 min-h-[72px] flex items-center justify-center ${
                      today ? 'bg-bo-accent/3' : ''
                    }`}
                  >
                    {dayShift ? (
                      <div
                        className={`w-full rounded-xl border px-2.5 py-2 cursor-pointer transition-all hover:shadow-sm ${typeColors[dayShift.type]}`}
                        onClick={() => setEditingShift(editingShift === dayShift.id ? null : dayShift.id)}
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-bold">
                            {dayShift.startTime}
                          </p>
                          <p className="text-[11px] font-bold">
                            {dayShift.endTime}
                          </p>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[9px] opacity-60">
                            {shiftDurationHours(dayShift).toFixed(1)}h
                          </span>
                          {dayShift.breakMinutes > 0 && (
                            <span className="text-[9px] opacity-60 flex items-center gap-0.5">
                              <Coffee size={8} />
                              {dayShift.breakMinutes}min
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <button
                        className="w-full h-full min-h-[56px] rounded-xl border border-dashed border-gray-200 flex items-center justify-center hover:border-bo-accent/40 hover:bg-bo-accent/5 transition-all group"
                      >
                        <Plus size={14} className="text-gray-300 group-hover:text-bo-accent/60" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Week Summary */}
      <div className="grid grid-cols-4 gap-4">
        {/* Total hours */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Heures totales</span>
            <Clock size={16} className="text-bo-accent" />
          </div>
          <p className="text-2xl font-black text-gray-900">{totalWeekHours}h</p>
          <p className="text-xs text-gray-400 mt-1">
            sur {employees.reduce((s, e) => s + e.contractHours, 0)}h contrat
          </p>
        </div>

        {/* Employees coverage */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Couverture</span>
            <Users size={16} className="text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-gray-900">{employees.length}</p>
          <p className="text-xs text-gray-400 mt-1">employes planifies</p>
        </div>

        {/* Overtime alert */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Depassements</span>
            <AlertTriangle size={16} className="text-orange-500" />
          </div>
          <p className="text-2xl font-black text-gray-900">
            {employees.filter((e) => employeeWeekHours(weekShifts, e.id) > e.contractHours).length}
          </p>
          <p className="text-xs text-gray-400 mt-1">employes en overtime</p>
        </div>

        {/* Avg hours per employee */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Moyenne/employe</span>
            <BarChart3 size={16} className="text-violet-600" />
          </div>
          <p className="text-2xl font-black text-gray-900">
            {(totalWeekHours / employees.length).toFixed(1)}h
          </p>
          <p className="text-xs text-gray-400 mt-1">par employe</p>
        </div>
      </div>

      {/* Daily Coverage Chart */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
          <BarChart3 size={14} className="text-bo-accent" />
          Couverture journaliere
        </h3>
        <div className="grid grid-cols-7 gap-3">
          {dayCoverage.map((dc, idx) => {
            const maxH = Math.max(...dayCoverage.map((x) => x.totalHours), 1);
            const pct = (dc.totalHours / maxH) * 100;
            const today = isToday(dc.date);
            return (
              <div key={dc.date} className="text-center">
                <p className={`text-xs font-bold mb-2 ${today ? 'text-bo-accent' : 'text-gray-600'}`}>
                  {DAYS[idx]}
                </p>
                <div className="h-32 bg-gray-100 rounded-xl relative overflow-hidden flex items-end">
                  <div
                    className={`w-full rounded-xl transition-all duration-500 ${
                      today
                        ? 'bg-gradient-to-t from-bo-accent to-purple-400'
                        : 'bg-gradient-to-t from-gray-300 to-gray-200'
                    }`}
                    style={{ height: `${pct}%` }}
                  />
                </div>
                <p className="text-xs font-semibold text-gray-700 mt-2">{dc.totalHours}h</p>
                <p className="text-[10px] text-gray-400">{dc.headcount} pers.</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Employee Hours Detail */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Users size={14} className="text-bo-accent" />
            Detail heures par employe
          </h3>
        </div>
        <div className="divide-y divide-gray-50">
          {employees.map((emp) => {
            const weekH = Math.round(employeeWeekHours(weekShifts, emp.id) * 10) / 10;
            const pct = emp.contractHours > 0 ? Math.min(120, (weekH / emp.contractHours) * 100) : 0;
            const isOver = weekH > emp.contractHours;
            const isUnder = weekH < emp.contractHours - 2;

            return (
              <div key={emp.id} className="px-6 py-3 flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-bo-accent/20 to-purple-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-bo-accent">{emp.avatar}</span>
                </div>
                <div className="w-36">
                  <p className="text-sm font-semibold text-gray-800">{emp.name}</p>
                  <p className="text-[10px] text-gray-400">{emp.role}</p>
                </div>
                <div className="flex-1">
                  <div className="bg-gray-100 rounded-full h-4 relative overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isOver
                          ? 'bg-gradient-to-r from-orange-400 to-red-400'
                          : isUnder
                          ? 'bg-gradient-to-r from-amber-300 to-amber-400'
                          : 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                    {/* Overflow indicator */}
                    {isOver && (
                      <div
                        className="absolute top-0 h-full bg-red-400/40 border-l-2 border-red-500"
                        style={{ left: `${(emp.contractHours / weekH) * 100}%`, width: `${100 - (emp.contractHours / weekH) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
                <div className="w-24 text-right">
                  <span className={`text-sm font-bold ${
                    isOver ? 'text-orange-600' : isUnder ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {weekH}h
                  </span>
                  <span className="text-xs text-gray-400"> / {emp.contractHours}h</span>
                </div>
                <div className="w-6">
                  {isOver && <AlertTriangle size={14} className="text-orange-500" />}
                  {!isOver && !isUnder && <CheckCircle2 size={14} className="text-emerald-500" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
