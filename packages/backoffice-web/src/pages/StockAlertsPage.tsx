import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AlertTriangle, Package, TrendingDown, RefreshCw,
  Search, Filter, ChevronDown, Check, X,
} from 'lucide-react';
import { notificationsApi, stockApi } from '../services/api';
import { useCurrentStoreId } from '../hooks/useCurrentStoreId';

/* ── Types ── */

interface StockNotification {
  productId: string;
  productName: string;
  ean: string;
  stockQuantity: number;
  alertThreshold: number;
  criticalThreshold: number;
  level: 'alert' | 'critical' | 'out_of_stock';
  message: string;
}

type LevelFilter = 'all' | 'out_of_stock' | 'critical' | 'alert';

/* ── Helpers ── */

const levelConfig: Record<StockNotification['level'], { bg: string; text: string; badge: string; label: string; order: number }> = {
  out_of_stock: { bg: 'bg-red-50', text: 'text-red-700', badge: 'bg-red-100 text-red-700 border-red-200', label: 'Rupture', order: 0 },
  critical: { bg: 'bg-red-50/50', text: 'text-red-600', badge: 'bg-red-50 text-red-600 border-red-100', label: 'Critique', order: 1 },
  alert: { bg: 'bg-amber-50/50', text: 'text-amber-600', badge: 'bg-amber-50 text-amber-600 border-amber-100', label: 'Bas', order: 2 },
};

/* ── Inline Adjust Modal ── */

function AdjustModal({
  product,
  onClose,
  onAdjusted,
}: {
  product: StockNotification;
  onClose: () => void;
  onAdjusted: () => void;
}) {
  const [quantity, setQuantity] = useState(String(product.stockQuantity));
  const [reason, setReason] = useState('Reapprovisionnement');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 0) {
      setError('Quantite invalide');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await stockApi.adjust(product.productId, { quantity: qty, reason });
      onAdjusted();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erreur lors de l\'ajustement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 mx-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg text-bo-text">Ajuster le stock</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="bg-gray-50 rounded-xl p-4">
          <p className="font-semibold text-bo-text">{product.productName}</p>
          <p className="text-xs text-gray-500 mt-0.5">EAN: {product.ean}</p>
          <p className="text-xs text-gray-500">Stock actuel: <strong>{product.stockQuantity}</strong></p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Nouvelle quantite
          </label>
          <input
            type="number"
            min={0}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Raison
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option>Reapprovisionnement</option>
            <option>Inventaire</option>
            <option>Correction erreur</option>
            <option>Retour fournisseur</option>
            <option>Casse / Perte</option>
          </select>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */

export function StockAlertsPage() {
  const storeId = useCurrentStoreId();
  const [alerts, setAlerts] = useState<StockNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [adjustProduct, setAdjustProduct] = useState<StockNotification | null>(null);

  const fetchAlerts = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const res = await notificationsApi.stockAlerts(storeId);
      setAlerts(res.data || []);
      setError(null);
    } catch (err: any) {
      console.warn('[StockAlerts] Failed to load:', err?.message);
      setError('Impossible de charger les alertes stock. Réessayez.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const filtered = useMemo(() => {
    let list = alerts;
    if (levelFilter !== 'all') {
      list = list.filter((a) => a.level === levelFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.productName.toLowerCase().includes(q) ||
          a.ean.includes(q),
      );
    }
    return list;
  }, [alerts, levelFilter, search]);

  const stats = useMemo(() => {
    const outOfStock = alerts.filter((a) => a.level === 'out_of_stock').length;
    const critical = alerts.filter((a) => a.level === 'critical').length;
    const alert = alerts.filter((a) => a.level === 'alert').length;
    return { total: alerts.length, outOfStock, critical, alert };
  }, [alerts]);

  const handleAdjusted = () => {
    setAdjustProduct(null);
    fetchAlerts();
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Error banner */}
      {fetchError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-red-600">{fetchError}</span>
          <button onClick={fetchAlerts} className="text-sm text-red-700 font-semibold hover:underline">Réessayer</button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <AlertTriangle size={22} className="text-amber-600" />
            </div>
            Alertes Stock
          </h1>
          <p className="text-sm text-bo-muted mt-1">
            Suivi en temps reel des produits sous seuil d'alerte.
          </p>
        </div>
        <button
          onClick={fetchAlerts}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-bo-accent text-white font-semibold text-sm hover:bg-bo-accent/90 transition-all shadow-lg shadow-bo-accent/25 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Actualiser
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Total alertes"
          value={stats.total}
          icon={<Package size={18} />}
          color="bg-gray-100 text-gray-600"
        />
        <StatCard
          label="Ruptures"
          value={stats.outOfStock}
          icon={<X size={18} />}
          color="bg-red-100 text-red-700"
        />
        <StatCard
          label="Critique"
          value={stats.critical}
          icon={<AlertTriangle size={18} />}
          color="bg-red-50 text-red-600"
        />
        <StatCard
          label="Stock bas"
          value={stats.alert}
          icon={<TrendingDown size={18} />}
          color="bg-amber-50 text-amber-600"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher un produit ou EAN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
          />
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {([
            { key: 'all', label: 'Tous' },
            { key: 'out_of_stock', label: 'Ruptures' },
            { key: 'critical', label: 'Critique' },
            { key: 'alert', label: 'Bas' },
          ] as { key: LevelFilter; label: string }[]).map((f) => (
            <button
              key={f.key}
              onClick={() => setLevelFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                levelFilter === f.key
                  ? 'bg-white text-bo-text shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f.label}
              {f.key !== 'all' && (
                <span className="ml-1 text-[10px]">
                  ({f.key === 'out_of_stock' ? stats.outOfStock : f.key === 'critical' ? stats.critical : stats.alert})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-bo-border/30 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <RefreshCw size={24} className="animate-spin text-bo-muted mx-auto mb-2" />
            <p className="text-sm text-bo-muted">Chargement des alertes...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Check size={32} className="text-emerald-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-bo-text">Aucune alerte stock</p>
            <p className="text-xs text-bo-muted mt-1">
              {search || levelFilter !== 'all'
                ? 'Aucun resultat pour ce filtre'
                : 'Tous les produits sont au-dessus des seuils'}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-bo-border/20">
                <th className="text-left px-6 py-3 text-[10px] font-bold text-bo-muted uppercase tracking-wider">Produit</th>
                <th className="text-center px-3 py-3 text-[10px] font-bold text-bo-muted uppercase tracking-wider">EAN</th>
                <th className="text-center px-3 py-3 text-[10px] font-bold text-bo-muted uppercase tracking-wider">Niveau</th>
                <th className="text-center px-3 py-3 text-[10px] font-bold text-bo-muted uppercase tracking-wider">Stock</th>
                <th className="text-center px-3 py-3 text-[10px] font-bold text-bo-muted uppercase tracking-wider">Seuil alerte</th>
                <th className="text-center px-3 py-3 text-[10px] font-bold text-bo-muted uppercase tracking-wider">Seuil critique</th>
                <th className="text-center px-3 py-3 text-[10px] font-bold text-bo-muted uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bo-border/10">
              {filtered.map((a) => {
                const config = levelConfig[a.level];
                return (
                  <tr key={a.productId} className={`hover:bg-bo-subtle/20 transition-colors ${config.bg}`}>
                    <td className="px-6 py-3">
                      <p className="text-sm font-semibold text-bo-text">{a.productName}</p>
                    </td>
                    <td className="text-center px-3 py-3 text-xs font-mono text-bo-muted">{a.ean}</td>
                    <td className="text-center px-3 py-3">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border ${config.badge}`}>
                        {a.level === 'out_of_stock' && <X size={10} />}
                        {a.level === 'critical' && <AlertTriangle size={10} />}
                        {a.level === 'alert' && <TrendingDown size={10} />}
                        {config.label}
                      </span>
                    </td>
                    <td className={`text-center px-3 py-3 text-sm font-bold ${config.text}`}>
                      {a.stockQuantity}
                    </td>
                    <td className="text-center px-3 py-3 text-xs text-amber-600 font-semibold">{a.alertThreshold}</td>
                    <td className="text-center px-3 py-3 text-xs text-red-600 font-semibold">{a.criticalThreshold}</td>
                    <td className="text-center px-3 py-3">
                      <button
                        onClick={() => setAdjustProduct(a)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Ajuster
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Adjust modal */}
      {adjustProduct && (
        <AdjustModal
          product={adjustProduct}
          onClose={() => setAdjustProduct(null)}
          onAdjusted={handleAdjusted}
        />
      )}
    </div>
  );
}

/* ── Stat Card ── */

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100/50">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-bo-text">{value}</p>
          <p className="text-xs text-bo-muted">{label}</p>
        </div>
      </div>
    </div>
  );
}
