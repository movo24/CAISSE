import React, { useState, useEffect, useCallback } from 'react';
import { Wallet, Download, Printer, Loader2, AlertCircle, Calendar } from 'lucide-react';
import { timewinApi } from '../services/api';
import { useCurrentStoreId } from '../hooks/useCurrentStoreId';
import { exportPayrollCSV, printPayslip } from '../utils/export-utils';
import { MonthPayroll, formatCurrency, formatHours } from '../utils/payroll-calculator';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Defensively map a TimeWin24 payroll record into the export shape. */
function toMonthPayroll(r: any, month: string): MonthPayroll {
  return {
    employeeName: r?.employeeName ?? r?.employee_name ?? r?.fullName ?? 'Employé',
    role: r?.role ?? r?.pos_role ?? '',
    month: r?.month ?? month,
    daysWorked: num(r?.daysWorked ?? r?.days_worked),
    totalWorkedHours: num(r?.totalWorkedHours ?? r?.total_worked_hours ?? r?.hours),
    regularHours: num(r?.regularHours ?? r?.regular_hours),
    overtimeHours25: num(r?.overtimeHours25 ?? r?.overtime_hours_25),
    overtimeHours50: num(r?.overtimeHours50 ?? r?.overtime_hours_50),
    grossRegular: num(r?.grossRegular ?? r?.gross_regular),
    grossOvertime25: num(r?.grossOvertime25 ?? r?.gross_overtime_25),
    grossOvertime50: num(r?.grossOvertime50 ?? r?.gross_overtime_50),
    grossTotal: num(r?.grossTotal ?? r?.gross_total),
    employeeSocialCharges: num(r?.employeeSocialCharges ?? r?.employee_social_charges),
    netBeforeTax: num(r?.netBeforeTax ?? r?.net_before_tax),
    employerSocialCharges: num(r?.employerSocialCharges ?? r?.employer_social_charges),
  };
}

export function PayrollPage() {
  const storeId = useCurrentStoreId();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<MonthPayroll[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeName, setStoreName] = useState('Magasin');

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await timewinApi.payroll(storeId, month);
      const raw = res.data;
      const list: any[] = Array.isArray(raw) ? raw : raw?.payroll || raw?.rows || raw?.data || [];
      setRows(list.map((r) => toMonthPayroll(r, month)));
      if (raw?.storeName) setStoreName(raw.storeName);
    } catch (err: any) {
      setError(
        err?.response?.status === 502 || err?.response?.status === 404
          ? "Le flux paie TimeWin24 n'est pas disponible (intégration RH non configurée)."
          : err?.response?.data?.message || 'Erreur lors du chargement de la paie.',
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [storeId, month]);

  useEffect(() => { load(); }, [load]);

  const totalGross = rows.reduce((s, r) => s + r.grossTotal, 0);
  const totalEmployerCost = rows.reduce((s, r) => s + r.grossTotal + r.employerSocialCharges, 0);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <Wallet size={28} className="text-bo-accent" />
            Paie & heures
          </h1>
          <p className="text-sm text-bo-muted mt-1">Export des heures et de la paie (source : TimeWin24)</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
            />
          </div>
          <button
            onClick={() => exportPayrollCSV(rows, month)}
            disabled={rows.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 bg-bo-accent text-white rounded-xl font-semibold text-sm hover:bg-bo-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={16} /> Exporter CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {!error && rows.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <p className="text-xs text-bo-muted">Employés</p>
            <p className="text-2xl font-bold text-bo-text mt-1">{rows.length}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <p className="text-xs text-bo-muted">Brut total</p>
            <p className="text-2xl font-bold text-bo-text mt-1">{formatCurrency(totalGross)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <p className="text-xs text-bo-muted">Coût employeur</p>
            <p className="text-2xl font-bold text-bo-text mt-1">{formatCurrency(totalEmployerCost)}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-bo-accent" /></div>
      ) : rows.length === 0 && !error ? (
        <div className="text-center py-20 text-bo-muted">
          <Wallet size={48} className="mx-auto mb-3 opacity-30" />
          <p className="text-lg font-semibold">Aucune donnée de paie</p>
          <p className="text-sm mt-1">Sélectionnez un mois avec des heures pointées.</p>
        </div>
      ) : rows.length > 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50/50 text-left">
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider">Employé</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">Heures</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">HS 25/50</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">Brut</th>
                <th className="py-3 px-5 text-xs font-semibold text-bo-muted uppercase tracking-wider text-right">Net avant impôt</th>
                <th className="py-3 px-5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gray-50 hover:bg-gray-50/40">
                  <td className="py-3 px-5">
                    <p className="font-semibold text-sm text-bo-text">{r.employeeName}</p>
                    <p className="text-xs text-bo-muted">{r.role}</p>
                  </td>
                  <td className="py-3 px-5 text-right text-sm">{formatHours(r.totalWorkedHours)}</td>
                  <td className="py-3 px-5 text-right text-sm">{formatHours(r.overtimeHours25)} / {formatHours(r.overtimeHours50)}</td>
                  <td className="py-3 px-5 text-right text-sm font-semibold">{formatCurrency(r.grossTotal)}</td>
                  <td className="py-3 px-5 text-right text-sm">{formatCurrency(r.netBeforeTax)}</td>
                  <td className="py-3 px-5 text-right">
                    <button onClick={() => printPayslip(r, storeName)} title="Imprimer la fiche" className="p-2 rounded-lg hover:bg-gray-100 text-bo-muted">
                      <Printer size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
