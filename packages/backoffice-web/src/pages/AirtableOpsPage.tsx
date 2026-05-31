import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  PlayCircle,
  AlertTriangle,
  Clock,
  Shield,
  Database,
  Filter,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { airtableOpsApi } from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type OperationStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface AirtableOperation {
  id: string;
  entityType: string;
  entityId: string;
  storeId: string;
  field: string;
  currentValue: unknown;
  proposedValue: unknown;
  riskLevel: RiskLevel;
  status: OperationStatus;
  sourceAirtableRecordId: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  appliedAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

interface OperationsPage {
  data: AirtableOperation[];
  total: number;
  page: number;
  limit: number;
}

interface Stats {
  pending: number;
  approved: number;
  rejected: number;
  applied: number;
  failed: number;
  byRisk: Record<RiskLevel, number>;
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const riskConfig: Record<RiskLevel, { label: string; color: string }> = {
  low: { label: 'Faible', color: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  medium: { label: 'Moyen', color: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  high: { label: 'Eleve', color: 'bg-orange-50 text-orange-700 ring-orange-600/20' },
  critical: { label: 'Critique', color: 'bg-red-50 text-red-700 ring-red-600/20' },
};

const statusConfig: Record<OperationStatus, { label: string; color: string; icon: React.ComponentType<any> }> = {
  pending: { label: 'En attente', color: 'bg-gray-50 text-gray-600', icon: Clock },
  approved: { label: 'Approuve', color: 'bg-blue-50 text-blue-700', icon: CheckCircle2 },
  rejected: { label: 'Rejete', color: 'bg-red-50 text-red-600', icon: XCircle },
  applied: { label: 'Applique', color: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
  failed: { label: 'Erreur', color: 'bg-red-50 text-red-600', icon: AlertTriangle },
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  return String(v);
}

// ── Main component ────────────────────────────────────────────────────────────

export function AirtableOpsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<OperationStatus | ''>('');
  const [riskFilter, setRiskFilter] = useState<RiskLevel | ''>('');
  const [operationsPage, setOperationsPage] = useState<OperationsPage | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [opsRes, statsRes] = await Promise.all([
        airtableOpsApi.listOperations({
          page,
          limit: 20,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(riskFilter ? { riskLevel: riskFilter } : {}),
        }),
        airtableOpsApi.getStats(),
      ]);
      setOperationsPage(opsRes.data);
      setStats(statsRes.data);
    } catch {
      setError('Erreur lors du chargement des donnees');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, riskFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await airtableOpsApi.triggerSync();
      setSuccess('Synchronisation lancee en arriere-plan');
      setTimeout(() => setSuccess(null), 4000);
    } catch {
      setError('Impossible de lancer la synchronisation');
    } finally {
      setSyncing(false);
    }
  };

  const handleApprove = async (id: string) => {
    setActionLoading(id + '-approve');
    setError(null);
    try {
      await airtableOpsApi.approveOperation(id);
      setSuccess('Operation approuvee');
      setTimeout(() => setSuccess(null), 3000);
      fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erreur lors de l\'approbation');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!rejectModal || !rejectReason.trim()) return;
    setActionLoading(rejectModal.id + '-reject');
    setError(null);
    try {
      await airtableOpsApi.rejectOperation(rejectModal.id, rejectReason);
      setSuccess('Operation rejetee');
      setTimeout(() => setSuccess(null), 3000);
      setRejectModal(null);
      setRejectReason('');
      fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erreur lors du rejet');
    } finally {
      setActionLoading(null);
    }
  };

  const handleApply = async (id: string) => {
    setActionLoading(id + '-apply');
    setError(null);
    try {
      await airtableOpsApi.applyOperation(id);
      setSuccess('Operation appliquee au POS');
      setTimeout(() => setSuccess(null), 3000);
      fetchData();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erreur lors de l\'application');
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = operationsPage
    ? Math.ceil(operationsPage.total / operationsPage.limit)
    : 1;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Database className="h-6 w-6 text-indigo-600" />
            Airtable Ops
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Propositions de modifications Airtable — validation avant application au POS
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Synchroniser Airtable
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          {(['pending', 'approved', 'applied', 'rejected', 'failed'] as OperationStatus[]).map((s) => {
            const cfg = statusConfig[s];
            const Icon = cfg.icon;
            return (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(statusFilter === s ? '' : s);
                  setPage(1);
                }}
                className={`p-3 rounded-xl border text-left transition-all ${
                  statusFilter === s ? 'ring-2 ring-indigo-500 border-indigo-300' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="h-4 w-4 text-gray-400" />
                  <span className="text-xs font-medium text-gray-500">{cfg.label}</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{stats[s]}</p>
              </button>
            );
          })}
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
          {Object.entries(statusConfig).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          value={riskFilter}
          onChange={(e) => { setRiskFilter(e.target.value as any); setPage(1); }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
        >
          <option value="">Tous les risques</option>
          {Object.entries(riskConfig).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        {(statusFilter || riskFilter) && (
          <button
            onClick={() => { setStatusFilter(''); setRiskFilter(''); setPage(1); }}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Reinitialiser
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {operationsPage?.data.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Aucune operation trouvee</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Entite</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Champ</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Actuel</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Propose</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Risque</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Statut</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {operationsPage?.data.map((op) => {
                  const risk = riskConfig[op.riskLevel];
                  const status = statusConfig[op.status];
                  const StatusIcon = status.icon;

                  return (
                    <tr key={op.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 capitalize">{op.entityType}</p>
                        <p className="text-xs text-gray-400 font-mono truncate max-w-[100px]">{op.entityId.slice(0, 8)}…</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{op.field}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[120px] truncate">{formatValue(op.currentValue)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-[120px] truncate">{formatValue(op.proposedValue)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${risk.color}`}>
                          {op.riskLevel === 'high' || op.riskLevel === 'critical' ? (
                            <Shield className="h-3 w-3" />
                          ) : null}
                          {risk.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                          <StatusIcon className="h-3 w-3" />
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {new Date(op.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {op.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleApprove(op.id)}
                                disabled={actionLoading === op.id + '-approve'}
                                title="Approuver"
                                className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                              >
                                {actionLoading === op.id + '-approve' ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4" />
                                )}
                              </button>
                              <button
                                onClick={() => setRejectModal({ id: op.id })}
                                title="Rejeter"
                                className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          {op.status === 'approved' && (
                            <button
                              onClick={() => handleApply(op.id)}
                              disabled={actionLoading === op.id + '-apply'}
                              title="Appliquer au POS"
                              className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 disabled:opacity-40"
                            >
                              {actionLoading === op.id + '-apply' ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <PlayCircle className="h-4 w-4" />
                              )}
                            </button>
                          )}
                          {op.status === 'failed' && op.failureReason && (
                            <span title={op.failureReason} className="cursor-help p-1.5">
                              <AlertTriangle className="h-4 w-4 text-red-400" />
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>
            {operationsPage?.total ?? 0} operation{(operationsPage?.total ?? 0) !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2">
              Page {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Rejeter l'operation</h2>
            <p className="text-sm text-gray-500 mb-4">
              Indiquez la raison du rejet (visible dans l'historique).
            </p>
            <textarea
              autoFocus
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Ex: Modification non validee par le responsable..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => { setRejectModal(null); setRejectReason(''); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
              >
                Annuler
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim() || actionLoading !== null}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Rejeter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
