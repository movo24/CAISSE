import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert, CheckCircle2, XCircle, AlertTriangle, Info,
  Filter, Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { salesGuardsApi } from '../services/api';

type Severity = 'info' | 'warning' | 'critical';
type Status = 'detected' | 'approved' | 'ignored' | 'resolved';

interface Anomaly {
  id: string;
  storeId: string;
  sellerId: string;
  saleId: string | null;
  productId: string | null;
  code: string;
  severity: Severity;
  blocking: boolean;
  managerApprovalRequired: boolean;
  message: string;
  metadata: Record<string, unknown> | null;
  status: Status;
  createdAt: string;
}

interface AnomaliesPage {
  data: Anomaly[];
  total: number;
  page: number;
  limit: number;
}

interface Summary {
  byCode: Record<string, number>;
  bySeverity: Record<string, number>;
  total: number;
}

const CODE_LABELS: Record<string, string> = {
  SALE_BELOW_COST: 'Vente sous le coût',
  LOW_MARGIN: 'Marge faible',
  COST_MISSING: 'Coût manquant',
  MANUAL_PRICE_OVERRIDE: 'Prix manuel',
  MANUAL_PRICE_OVERRIDE_HIGH: 'Prix manuel fort écart',
  EXCESSIVE_DISCOUNT: 'Remise excessive',
  FREE_PRODUCT_ABUSE: 'Produit libre abusif',
  REPEATED_CANCELLATIONS: 'Annulations répétées',
  SUSPICIOUS_PRICE_CHANGE: 'Changement de prix suspect',
};

const severityCfg: Record<Severity, { color: string; icon: React.ComponentType<any>; label: string }> = {
  critical: { color: 'bg-red-50 text-red-600', icon: XCircle, label: 'Critique' },
  warning: { color: 'bg-amber-50 text-amber-700', icon: AlertTriangle, label: 'Warning' },
  info: { color: 'bg-blue-50 text-blue-600', icon: Info, label: 'Info' },
};

const statusCfg: Record<Status, { color: string; label: string }> = {
  detected: { color: 'bg-gray-50 text-gray-600', label: 'Détectée' },
  approved: { color: 'bg-emerald-50 text-emerald-700', label: 'Approuvée' },
  ignored: { color: 'bg-gray-100 text-gray-400', label: 'Ignorée' },
  resolved: { color: 'bg-blue-50 text-blue-600', label: 'Résolue' },
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SalesGuardsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<Status | ''>('detected');
  const [severityFilter, setSeverityFilter] = useState<Severity | ''>('');
  const [codeFilter, setCodeFilter] = useState('');
  const [todayOnly, setTodayOnly] = useState(true);
  const [pageData, setPageData] = useState<AnomaliesPage | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const from = todayOnly ? todayIso() : undefined;
    try {
      const [listRes, sumRes] = await Promise.all([
        salesGuardsApi.listAnomalies({
          page,
          limit: 25,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(severityFilter ? { severity: severityFilter } : {}),
          ...(codeFilter ? { code: codeFilter } : {}),
          ...(from ? { from } : {}),
        }),
        salesGuardsApi.summary(undefined, from),
      ]);
      setPageData(listRes.data);
      setSummary(sumRes.data);
    } catch {
      setError('Erreur lors du chargement des anomalies');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, severityFilter, codeFilter, todayOnly]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleApprove = async (id: string) => {
    setActionLoading(id + '-a');
    try {
      await salesGuardsApi.approve(id);
      fetchData();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur approbation');
    } finally {
      setActionLoading(null);
    }
  };

  const handleIgnore = async (id: string) => {
    setActionLoading(id + '-i');
    try {
      await salesGuardsApi.ignore(id);
      fetchData();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = pageData ? Math.ceil(pageData.total / pageData.limit) : 1;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-red-500" />
            Garde-fous caisse
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Anomalies détectées : ventes sous coût, marges faibles, remises et annulations suspectes
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={todayOnly}
            onChange={(e) => { setTodayOnly(e.target.checked); setPage(1); }}
          />
          Aujourd'hui seulement
        </label>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Summary chips by code */}
      {summary && summary.total > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {Object.entries(summary.byCode)
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => (
              <button
                key={code}
                onClick={() => { setCodeFilter(codeFilter === code ? '' : code); setPage(1); }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  codeFilter === code
                    ? 'ring-2 ring-indigo-500 border-indigo-300'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {CODE_LABELS[code] ?? code} · {count}
              </button>
            ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <Filter className="h-4 w-4 text-gray-400" />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(statusCfg).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select
          value={severityFilter}
          onChange={(e) => { setSeverityFilter(e.target.value as any); setPage(1); }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
        >
          <option value="">Toutes sévérités</option>
          {Object.entries(severityCfg).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {(codeFilter || severityFilter || statusFilter !== 'detected') && (
          <button
            onClick={() => { setCodeFilter(''); setSeverityFilter(''); setStatusFilter('detected'); setPage(1); }}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {pageData?.data.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <ShieldAlert className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Aucune anomalie sur la période</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Message</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Sévérité</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Statut</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pageData?.data.map((a) => {
                  const sev = severityCfg[a.severity];
                  const SevIcon = sev.icon;
                  const st = statusCfg[a.status];
                  return (
                    <tr key={a.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">{CODE_LABELS[a.code] ?? a.code}</span>
                        {a.blocking && (
                          <span className="ml-2 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-semibold">
                            bloquant
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[340px]">{a.message}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sev.color}`}>
                          <SevIcon className="h-3 w-3" /> {sev.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {new Date(a.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        {a.status === 'detected' && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleApprove(a.id)}
                              disabled={actionLoading === a.id + '-a'}
                              title="Approuver"
                              className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                            >
                              {actionLoading === a.id + '-a' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => handleIgnore(a.id)}
                              disabled={actionLoading === a.id + '-i'}
                              title="Ignorer"
                              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 disabled:opacity-40"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>{pageData?.total ?? 0} anomalie{(pageData?.total ?? 0) !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2">Page {page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
