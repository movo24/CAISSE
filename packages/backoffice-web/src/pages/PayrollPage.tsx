import React, { useState, useMemo, useEffect } from 'react';
import {
  Euro, Clock, Users, Calculator, ChevronLeft, ChevronRight,
  Download, Printer, FileText, AlertTriangle, CheckCircle2,
  TrendingUp, TrendingDown, Settings, Edit3, Save,
  BarChart3, Wallet, Building2,
} from 'lucide-react';
import {
  EmployeePayConfig, MonthPayroll,
  calculateMonthPayroll,
  formatCurrency, formatHours,
} from '../utils/payroll-calculator';
import { exportPayrollCSV, printPayslip } from '../utils/export-utils';
import { payrollApi, employeesApi, storesApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';

/* ═══════════════════════════════════════════════════════════════
   PAYROLL PAGE — Backoffice
   Config taux horaire, résumé mensuel, détail journalier
   Données pointage via API.
   ═══════════════════════════════════════════════════════════════ */


function buildPayrolls(month: string, configs: EmployeePayConfig[]): MonthPayroll[] {
  return configs.map((config) => {
    return calculateMonthPayroll(config, [], month);
  });
}

// ── Helpers ──

const MONTHS_FR = [
  'Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre',
];

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(m: string): string {
  const [year, mo] = m.split('-');
  return `${MONTHS_FR[parseInt(mo, 10) - 1]} ${year}`;
}

// ── Component ──

export function PayrollPage() {
  const [month, setMonth] = useState(currentMonth());
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [configMode, setConfigMode] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [payConfigs, setPayConfigs] = useState<EmployeePayConfig[]>([]);

  useEffect(() => {
    employeesApi.list().then((res) => {
      const emps: any[] = res.data || [];
      setPayConfigs(emps.map((e: any) => ({
        employeeId: e.id,
        employeeName: `${e.firstName} ${e.lastName}`,
        role: e.role || 'Caissier',
        hourlyRateGross: 1320,
        contractHoursWeek: 35,
        overtimeRate25: 1.25,
        overtimeRate50: 1.50,
      })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    storesApi.list().then((res) => {
      const stores: any[] = res.data || [];
      if (stores.length > 0) {
        setStoreName(stores[0].name || '');
      }
    }).catch(() => {});
  }, []);

  const payrolls = useMemo(() => buildPayrolls(month, payConfigs), [month, payConfigs]);
  const selected = selectedEmployee ? payrolls.find((p) => p.employeeId === selectedEmployee) : null;

  // Totaux équipe
  const teamTotals = useMemo(() => {
    const grossTotal = payrolls.reduce((s, p) => s + p.grossTotal, 0);
    const netTotal = payrolls.reduce((s, p) => s + p.netBeforeTax, 0);
    const employerCharges = payrolls.reduce((s, p) => s + p.employerSocialCharges, 0);
    const totalHours = payrolls.reduce((s, p) => s + p.totalWorkedHours, 0);
    const totalOvertime = payrolls.reduce((s, p) => s + p.overtimeHours25 + p.overtimeHours50, 0);
    const costTotal = grossTotal + employerCharges;
    return { grossTotal, netTotal, employerCharges, totalHours, totalOvertime, costTotal };
  }, [payrolls]);

  return (
    <div className="p-8 space-y-6 bg-gray-50/50 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Wallet size={20} className="text-white" />
            </div>
            Gestion Paie
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Recapitulatif mensuel des salaires et charges
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setConfigMode(!configMode)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium border transition-colors ${
              configMode ? 'bg-bo-accent text-white border-bo-accent' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Settings size={14} />
            Taux horaires
          </button>
          <button
            onClick={() => exportPayrollCSV(payrolls, month)}
            className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 px-6 py-3">
        <button onClick={() => setMonth(prevMonth(month))} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
          <ChevronLeft size={18} className="text-gray-600" />
        </button>
        <div className="text-center">
          <p className="text-lg font-bold text-gray-900">{monthLabel(month)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{payrolls.length} employes — {formatHours(teamTotals.totalHours)} travaillees</p>
        </div>
        <div className="flex items-center gap-2">
          {month !== currentMonth() && (
            <button onClick={() => setMonth(currentMonth())} className="text-xs font-medium text-bo-accent hover:underline mr-2">
              Mois courant
            </button>
          )}
          <button onClick={() => setMonth(nextMonth(month))} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <ChevronRight size={18} className="text-gray-600" />
          </button>
        </div>
      </div>

      {/* Team KPIs */}
      <div className="grid grid-cols-6 gap-4">
        {[
          { label: 'Masse salariale brute', value: formatCurrency(teamTotals.grossTotal), icon: Euro, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Net a payer', value: formatCurrency(teamTotals.netTotal), icon: Wallet, color: 'text-blue-600 bg-blue-50' },
          { label: 'Charges patronales', value: formatCurrency(teamTotals.employerCharges), icon: Building2, color: 'text-orange-600 bg-orange-50' },
          { label: 'Cout total', value: formatCurrency(teamTotals.costTotal), icon: Calculator, color: 'text-red-600 bg-red-50' },
          { label: 'Heures totales', value: formatHours(teamTotals.totalHours), icon: Clock, color: 'text-violet-600 bg-violet-50' },
          { label: 'Heures sup', value: formatHours(teamTotals.totalOvertime), icon: TrendingUp, color: 'text-amber-600 bg-amber-50' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{kpi.label}</span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${kpi.color}`}>
                <kpi.icon size={16} />
              </div>
            </div>
            <p className="text-lg font-bold text-gray-900">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Config mode: hourly rates */}
      {configMode && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Settings size={14} className="text-bo-accent" />
            Configuration des taux horaires
          </h3>
          <div className="overflow-hidden rounded-xl border border-gray-100">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-[10px] text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5 font-semibold">Employe</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Role</th>
                  <th className="text-center px-4 py-2.5 font-semibold">Taux horaire brut</th>
                  <th className="text-center px-4 py-2.5 font-semibold">Heures/sem. contrat</th>
                  <th className="text-center px-4 py-2.5 font-semibold">HS +25%</th>
                  <th className="text-center px-4 py-2.5 font-semibold">HS +50%</th>
                </tr>
              </thead>
              <tbody>
                {payConfigs.map((c) => (
                  <tr key={c.employeeId} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-sm font-semibold text-gray-800">{c.employeeName}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{c.role}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-flex items-center bg-emerald-50 text-emerald-700 rounded-lg px-2.5 py-1 text-xs font-bold">
                        {formatCurrency(c.hourlyRateGross)}/h
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs font-bold text-gray-700">{c.contractHoursWeek}h</td>
                    <td className="px-4 py-2.5 text-center text-xs text-gray-500">x{c.overtimeRate25}</td>
                    <td className="px-4 py-2.5 text-center text-xs text-gray-500">x{c.overtimeRate50}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">
            En production, ces taux sont modifiables et lies au contrat de chaque employe.
          </p>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: Payroll Table */}
        <div className="col-span-7 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <FileText size={16} className="text-emerald-600" />
              Fiches de paie — {monthLabel(month)}
            </h2>
          </div>

          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50 text-[10px] text-gray-400 uppercase tracking-wider">
                <th className="text-left pl-6 py-3 font-semibold">Employe</th>
                <th className="text-center py-3 font-semibold">Heures</th>
                <th className="text-center py-3 font-semibold">HS</th>
                <th className="text-right py-3 font-semibold">Brut</th>
                <th className="text-right py-3 font-semibold">Net</th>
                <th className="text-right pr-4 py-3 font-semibold">Cout empl.</th>
                <th className="text-center py-3 pr-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payrolls.map((p) => {
                const isSelected = selectedEmployee === p.employeeId;
                const hasOvertime = p.overtimeHours25 + p.overtimeHours50 > 0;
                const costTotal = p.grossTotal + p.employerSocialCharges;

                return (
                  <tr
                    key={p.employeeId}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${
                      isSelected ? 'bg-emerald-50/50' : 'hover:bg-gray-50/80'
                    }`}
                    onClick={() => setSelectedEmployee(p.employeeId === selectedEmployee ? null : p.employeeId)}
                  >
                    <td className="pl-6 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-[9px] font-bold text-emerald-700">
                            {p.employeeName.split(' ').map((w) => w[0]).join('')}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{p.employeeName}</p>
                          <p className="text-[10px] text-gray-400">{p.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-center py-3">
                      <p className="text-sm font-semibold text-gray-900">{formatHours(p.totalWorkedHours)}</p>
                      <p className="text-[10px] text-gray-400">{p.daysWorked} jours</p>
                    </td>
                    <td className="text-center py-3">
                      {hasOvertime ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold">
                          <TrendingUp size={9} />
                          {formatHours(p.overtimeHours25 + p.overtimeHours50)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>
                    <td className="text-right py-3">
                      <p className="text-sm font-semibold text-gray-900">{formatCurrency(p.grossTotal)}</p>
                    </td>
                    <td className="text-right py-3">
                      <p className="text-sm font-bold text-emerald-700">{formatCurrency(p.netBeforeTax)}</p>
                    </td>
                    <td className="text-right py-3 pr-4">
                      <p className="text-xs text-gray-500">{formatCurrency(costTotal)}</p>
                    </td>
                    <td className="text-center py-3 pr-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); printPayslip(p, storeName); }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                        title="Imprimer fiche de paie"
                      >
                        <Printer size={13} className="text-gray-400" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Footer totals */}
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-200">
                <td className="pl-6 py-3 text-sm font-bold text-gray-700">TOTAUX</td>
                <td className="text-center py-3 text-sm font-bold text-gray-700">{formatHours(teamTotals.totalHours)}</td>
                <td className="text-center py-3 text-xs font-bold text-amber-600">{formatHours(teamTotals.totalOvertime)}</td>
                <td className="text-right py-3 text-sm font-bold text-gray-700">{formatCurrency(teamTotals.grossTotal)}</td>
                <td className="text-right py-3 text-sm font-bold text-emerald-700">{formatCurrency(teamTotals.netTotal)}</td>
                <td className="text-right py-3 pr-4 text-xs font-bold text-gray-500">{formatCurrency(teamTotals.costTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Right: Detail Panel */}
        <div className="col-span-5 space-y-4">
          {selected ? (
            <>
              {/* Employee Summary Card */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                      <span className="text-white text-base font-bold">
                        {selected.employeeName.split(' ').map((w) => w[0]).join('')}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">{selected.employeeName}</h3>
                      <p className="text-sm text-gray-500">{selected.role}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => printPayslip(selected, storeName)}
                    className="flex items-center gap-2 bg-emerald-50 text-emerald-700 rounded-xl px-3 py-2 text-xs font-semibold hover:bg-emerald-100 transition-colors"
                  >
                    <Printer size={12} />
                    Imprimer
                  </button>
                </div>

                {/* KPI Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Brut total', value: formatCurrency(selected.grossTotal), sub: formatHours(selected.totalWorkedHours), color: 'bg-gray-50' },
                    { label: 'Net a payer', value: formatCurrency(selected.netBeforeTax), sub: 'Avant impot', color: 'bg-emerald-50' },
                    { label: 'Heures normales', value: formatHours(selected.regularHours), sub: formatCurrency(selected.grossRegular), color: 'bg-blue-50' },
                    { label: 'Heures sup', value: formatHours(selected.overtimeHours25 + selected.overtimeHours50), sub: formatCurrency(selected.grossOvertime25 + selected.grossOvertime50), color: 'bg-amber-50' },
                  ].map((kpi) => (
                    <div key={kpi.label} className={`rounded-xl p-3 ${kpi.color}`}>
                      <span className="text-[10px] font-medium text-gray-400 uppercase">{kpi.label}</span>
                      <p className="text-base font-bold text-gray-900 mt-1">{kpi.value}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{kpi.sub}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Weekly Breakdown */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h4 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <BarChart3 size={14} className="text-emerald-600" />
                  Detail hebdomadaire
                </h4>
                <div className="space-y-2">
                  {selected.weeks.map((w, idx) => {
                    const hasOT = w.overtimeHours25 + w.overtimeHours50 > 0;
                    const weekDate = new Date(w.weekStart);
                    const weekLabel = `Sem. ${idx + 1} (${weekDate.getDate()}/${weekDate.getMonth() + 1})`;
                    const config = payConfigs.find((c) => c.employeeId === selected.employeeId);
                    const contractH = config?.contractHoursWeek || 35;
                    const pct = Math.min(120, (w.totalWorkedHours / contractH) * 100);

                    return (
                      <div key={w.weekStart} className="flex items-center gap-3">
                        <span className="text-xs text-gray-500 w-24 flex-shrink-0">{weekLabel}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              hasOT
                                ? 'bg-gradient-to-r from-amber-400 to-orange-400'
                                : 'bg-gradient-to-r from-emerald-400 to-teal-400'
                            }`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                          {/* Contract line */}
                          <div
                            className="absolute top-0 h-full w-px bg-gray-600/30"
                            style={{ left: `${Math.min(100, (contractH / (contractH * 1.2)) * 100)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-bold w-12 text-right ${hasOT ? 'text-amber-600' : 'text-gray-700'}`}>
                          {formatHours(w.totalWorkedHours)}
                        </span>
                        {hasOT && (
                          <span className="text-[9px] text-amber-600 font-medium w-14">
                            +{formatHours(w.overtimeHours25 + w.overtimeHours50)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Charges breakdown */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <Calculator size={14} className="text-gray-400" />
                  Decomposition
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5">
                    <span className="text-gray-500">Brut heures normales</span>
                    <span className="font-semibold text-gray-800">{formatCurrency(selected.grossRegular)}</span>
                  </div>
                  {selected.grossOvertime25 > 0 && (
                    <div className="flex justify-between py-1.5">
                      <span className="text-gray-500">Brut HS +25%</span>
                      <span className="font-semibold text-amber-700">{formatCurrency(selected.grossOvertime25)}</span>
                    </div>
                  )}
                  {selected.grossOvertime50 > 0 && (
                    <div className="flex justify-between py-1.5">
                      <span className="text-gray-500">Brut HS +50%</span>
                      <span className="font-semibold text-orange-700">{formatCurrency(selected.grossOvertime50)}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1.5 border-t border-gray-100 font-bold">
                    <span className="text-gray-700">Salaire brut total</span>
                    <span className="text-gray-900">{formatCurrency(selected.grossTotal)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 text-red-600">
                    <span>Cotisations salariales (22%)</span>
                    <span className="font-semibold">- {formatCurrency(selected.employeeSocialCharges)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-t-2 border-gray-800 font-bold text-sm">
                    <span className="text-gray-900">NET A PAYER</span>
                    <span className="text-emerald-700">{formatCurrency(selected.netBeforeTax)}</span>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="flex justify-between py-1.5 text-gray-400">
                      <span>Charges patronales (42%)</span>
                      <span className="font-semibold">{formatCurrency(selected.employerSocialCharges)}</span>
                    </div>
                    <div className="flex justify-between py-1.5 font-bold text-gray-600">
                      <span>Cout total employeur</span>
                      <span>{formatCurrency(selected.grossTotal + selected.employerSocialCharges)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <div className="w-16 h-16 rounded-3xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <FileText size={24} className="text-gray-300" />
              </div>
              <h3 className="text-base font-bold text-gray-400">Selectionnez un employe</h3>
              <p className="text-sm text-gray-300 mt-1">
                Cliquez sur une ligne pour voir le detail de sa fiche de paie
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
