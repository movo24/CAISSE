import { useState, useEffect, useCallback } from 'react';
import { PackageSearch, Check, X, Loader2, Inbox } from 'lucide-react';
import { productIntegrationApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { ProductScanPanel } from '../components/ProductScanPanel';

/**
 * Module Inventaire — Intégration produit.
 *
 * - Scan code-barres (douchette) : produit trouvé → fiche ; inconnu →
 *   demande d'intégration ou création sécurisée (code autorisé obligatoire).
 * - File des demandes d'intégration (caisse / dashboard / inventaire / mobile).
 * - File des produits « À valider » (activation réservée admin/responsable).
 */

const SOURCE_LABELS: Record<string, string> = {
  pos: 'Caisse',
  dashboard: 'Dashboard',
  inventory: 'Inventaire',
  mobile: 'Mobile',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function ProductIntegrationPage() {
  const { employee } = useAuthStore();
  const isManager = employee?.role === 'admin' || employee?.role === 'manager';

  const [requests, setRequests] = useState<any[]>([]);
  const [pendingProducts, setPendingProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isManager) { setLoading(false); return; }
    try {
      const [reqRes, prodRes] = await Promise.all([
        productIntegrationApi.listRequests('pending'),
        productIntegrationApi.listPendingProducts(),
      ]);
      setRequests(reqRes.data ?? []);
      setPendingProducts(prodRes.data ?? []);
    } catch {
      /* files réservées manager+ — le scan reste utilisable */
    } finally {
      setLoading(false);
    }
  }, [isManager]);

  useEffect(() => { refresh(); }, [refresh]);

  const decideRequest = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    setNotice(null);
    try {
      if (action === 'approve') {
        await productIntegrationApi.approveRequest(id, { activate: true });
        setNotice('Demande approuvée — fiche produit créée.');
      } else {
        const reason = window.prompt('Raison du rejet (journalisée) :') ?? undefined;
        await productIntegrationApi.rejectRequest(id, reason);
        setNotice('Demande rejetée.');
      }
      await refresh();
    } catch (e: any) {
      setNotice(e?.response?.data?.message || 'Action impossible (proposition incomplète ?). Utilisez le scan pour compléter la fiche.');
    } finally {
      setBusyId(null);
    }
  };

  const decideProduct = async (id: string, action: 'activate' | 'reject') => {
    setBusyId(id);
    setNotice(null);
    try {
      if (action === 'activate') {
        await productIntegrationApi.activateProduct(id);
        setNotice('Produit activé.');
      } else {
        const reason = window.prompt('Raison du rejet (journalisée) :') ?? undefined;
        await productIntegrationApi.rejectProduct(id, reason);
        setNotice('Produit rejeté.');
      }
      await refresh();
    } catch (e: any) {
      setNotice(e?.response?.data?.message || 'Action impossible.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-bo-accent/10 text-bo-accent flex items-center justify-center">
          <PackageSearch size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-bo-text">Intégration produit</h1>
          <p className="text-sm text-gray-500">
            Scan code-barres, produits inconnus, demandes d&rsquo;intégration et validation.
          </p>
        </div>
      </div>

      <ProductScanPanel source="inventory" onChanged={refresh} />

      {notice && (
        <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-800">{notice}</div>
      )}

      {isManager && (
        <>
          {/* ── Demandes d'intégration en attente ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Inbox size={16} className="text-bo-accent" />
              <h3 className="font-semibold text-sm text-bo-text">
                Demandes d&rsquo;intégration en attente
              </h3>
              <span className="ml-auto text-xs text-gray-400">{requests.length} demande{requests.length > 1 ? 's' : ''}</span>
            </div>
            {loading ? (
              <div className="p-6 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></div>
            ) : requests.length === 0 ? (
              <p className="p-6 text-sm text-gray-400 text-center">Aucune demande en attente.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="px-5 py-2.5 font-medium">Code-barres</th>
                      <th className="px-3 py-2.5 font-medium">Source</th>
                      <th className="px-3 py-2.5 font-medium">Terminal</th>
                      <th className="px-3 py-2.5 font-medium">Date</th>
                      <th className="px-3 py-2.5 font-medium">Commentaire</th>
                      <th className="px-3 py-2.5 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-5 py-3 font-mono">{r.barcode}</td>
                        <td className="px-3 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-lg ${r.source === 'pos' ? 'bg-orange-50 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                            {SOURCE_LABELS[r.source] ?? r.source}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-gray-500">{r.terminalId ?? '—'}</td>
                        <td className="px-3 py-3 text-gray-500">{formatDate(r.createdAt)}</td>
                        <td className="px-3 py-3 text-gray-500 max-w-[200px] truncate">{r.comment ?? '—'}</td>
                        <td className="px-3 py-3">
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => decideRequest(r.id, 'approve')}
                              disabled={busyId === r.id || !r.proposal?.name}
                              title={r.proposal?.name ? 'Créer la fiche depuis la proposition' : 'Proposition incomplète — scannez ce code pour compléter la fiche'}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 disabled:opacity-40 flex items-center gap-1"
                            >
                              <Check size={13} /> Approuver
                            </button>
                            <button
                              onClick={() => decideRequest(r.id, 'reject')}
                              disabled={busyId === r.id}
                              className="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 disabled:opacity-40 flex items-center gap-1"
                            >
                              <X size={13} /> Rejeter
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Produits à valider ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Check size={16} className="text-amber-500" />
              <h3 className="font-semibold text-sm text-bo-text">Produits à valider</h3>
              <span className="ml-auto text-xs text-gray-400">{pendingProducts.length} produit{pendingProducts.length > 1 ? 's' : ''}</span>
            </div>
            {pendingProducts.length === 0 ? (
              <p className="p-6 text-sm text-gray-400 text-center">Aucun produit en attente de validation.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="px-5 py-2.5 font-medium">Produit</th>
                      <th className="px-3 py-2.5 font-medium">Code-barres</th>
                      <th className="px-3 py-2.5 font-medium">Prix</th>
                      <th className="px-3 py-2.5 font-medium">Stock</th>
                      <th className="px-3 py-2.5 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingProducts.map((p) => (
                      <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-5 py-3 font-medium text-bo-text">{p.name}</td>
                        <td className="px-3 py-3 font-mono text-gray-500">{p.ean}</td>
                        <td className="px-3 py-3">{(p.priceMinorUnits / 100).toFixed(2).replace('.', ',')} €</td>
                        <td className="px-3 py-3">{p.stockQuantity}</td>
                        <td className="px-3 py-3">
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => decideProduct(p.id, 'activate')}
                              disabled={busyId === p.id}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 disabled:opacity-40 flex items-center gap-1"
                            >
                              <Check size={13} /> Activer
                            </button>
                            <button
                              onClick={() => decideProduct(p.id, 'reject')}
                              disabled={busyId === p.id}
                              className="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 disabled:opacity-40 flex items-center gap-1"
                            >
                              <X size={13} /> Rejeter
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
