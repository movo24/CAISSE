import { useState, useEffect, useCallback } from 'react';
import { CreditCard, CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { salesApi } from '../services/api';

interface Payment {
  method: string;
  amountMinorUnits: number;
  captured: boolean;
}

interface Sale {
  id: string;
  ticketNumber: string;
  totalMinorUnits: number;
  completedAt: string;
  payments: Payment[];
}

interface PendingRow {
  id: string;
  ticketNumber: string;
  totalMinorUnits: number;
  uncapturedMinorUnits: number;
  completedAt: string;
}

function formatMoney(minor: number): string {
  return (minor / 100).toFixed(2) + ' €';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PendingPaymentsPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await salesApi.pendingPayments();
      const sales: Sale[] = res.data ?? [];
      const mapped: PendingRow[] = sales.map((s: any) => ({
        id: s.id,
        ticketNumber: s.ticketNumber,
        totalMinorUnits: s.totalMinorUnits,
        completedAt: s.completedAt,
        uncapturedMinorUnits: (s.payments ?? [])
          .filter((p: any) => !p.captured)
          .reduce((sum: number, p: any) => sum + (p.amountMinorUnits ?? 0), 0),
      }));
      setRows(mapped);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const regularize = async (id: string, ticketNumber: string, paySuccess: boolean) => {
    setActionId(id + (paySuccess ? '-ok' : '-ko'));
    setError(null);
    setSuccess(null);
    try {
      await salesApi.regularizePayment(id, { success: paySuccess });
      if (paySuccess) {
        // Encaissement réussi : la ligne quitte la liste.
        setRows((prev) => prev.filter((r) => r.id !== id));
        setSuccess(`Encaissement du ticket ${ticketNumber} régularisé.`);
      } else {
        setSuccess(`Échec de capture enregistré pour le ticket ${ticketNumber}.`);
        await load();
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-bo-text mb-4 flex items-center gap-2">
        <CreditCard className="h-5 w-5 text-amber-500" />
        Paiements à régulariser
      </h1>
      <p className="text-sm text-bo-muted mb-4">
        Tickets dont une partie carte n'a pas été capturée. Confirmez l'encaissement ou enregistrez l'échec de capture.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {success}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="py-12 text-center text-bo-muted">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Aucun paiement à régulariser</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const busy = actionId === r.id + '-ok' || actionId === r.id + '-ko';
            return (
              <div
                key={r.id}
                className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-5">
                  <div>
                    <div className="text-sm font-semibold text-bo-text">
                      Ticket {r.ticketNumber}
                    </div>
                    <div className="text-xs text-bo-muted mt-0.5">
                      {formatDate(r.completedAt)}
                    </div>
                    <div className="text-xs text-bo-muted mt-0.5">
                      Total : {formatMoney(r.totalMinorUnits)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-amber-700 font-medium">
                      À régulariser
                    </div>
                    <div className="text-lg font-bold text-amber-600 leading-tight">
                      {formatMoney(r.uncapturedMinorUnits)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => regularize(r.id, r.ticketNumber, true)}
                    disabled={busy}
                    className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {actionId === r.id + '-ok' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Encaissement réussi
                  </button>
                  <button
                    onClick={() => regularize(r.id, r.ticketNumber, false)}
                    disabled={busy}
                    className="px-3 py-1.5 bg-red-50 text-red-600 text-sm font-semibold rounded-lg border border-red-200 hover:bg-red-100 disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {actionId === r.id + '-ko' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    Échec capture
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
