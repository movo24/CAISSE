import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { storesApi } from '../services/api';
import {
  Building2, TrendingUp, ShoppingBag, Receipt, ArrowRight,
  Loader2, BarChart3, Store, Trophy, AlertTriangle,
} from 'lucide-react';

interface StoreStat {
  id: string;
  name: string;
  storeCode: string;
  city: string;
  includeInNetwork: boolean;
  totalSales: number;
  totalRevenue: number;
  avgTicket: number;
  todaySales: number;
  todayRevenue: number;
}

interface NetworkData {
  network: {
    storeCount: number;
    excludedCount: number;
    totalRevenue: number;
    totalSales: number;
    avgTicket: number;
    todayRevenue: number;
    todaySales: number;
  };
  stores: StoreStat[];
  ranking: { rank: number; storeId: string; name: string; totalRevenue: number; todayRevenue: number }[];
  excludedStores: { id: string; name: string; storeCode: string }[];
}

function fmt(minorUnits: number): string {
  return (minorUnits / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20AC';
}

export function NetworkDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<NetworkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    storesApi.networkSummary()
      .then((res) => { setData(res.data); setLoading(false); })
      .catch((err) => {
        setError(err.response?.data?.message || 'Erreur chargement réseau');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={32} className="animate-spin text-bo-accent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  const { network, stores, ranking } = data;
  const maxRevenue = Math.max(...stores.map((s) => s.totalRevenue), 1);

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Building2 size={28} className="text-bo-accent" />
        <div>
          <h1 className="text-2xl font-bold text-bo-text">Vue Réseau</h1>
          <p className="text-sm text-bo-muted">
            {network.storeCount} magasin{network.storeCount > 1 ? 's' : ''} actif{network.storeCount > 1 ? 's' : ''}
            {network.excludedCount > 0 && ` (${network.excludedCount} exclu${network.excludedCount > 1 ? 's' : ''})`}
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard icon={TrendingUp} label="CA Total Réseau" value={fmt(network.totalRevenue)} accent />
        <KPICard icon={Receipt} label="Tickets Total" value={String(network.totalSales)} />
        <KPICard icon={ShoppingBag} label="Panier Moyen" value={fmt(network.avgTicket)} />
        <KPICard icon={Store} label="CA Aujourd'hui" value={fmt(network.todayRevenue)} sub={`${network.todaySales} ticket${network.todaySales > 1 ? 's' : ''}`} />
      </div>

      {/* Store Performance Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Store cards */}
        <div className="lg:col-span-2">
          <h2 className="text-lg font-bold text-bo-text mb-4 flex items-center gap-2">
            <BarChart3 size={18} className="text-bo-accent" />
            Performance par magasin
          </h2>
          <div className="space-y-3">
            {stores.map((store) => {
              const pct = maxRevenue > 0 ? (store.totalRevenue / maxRevenue) * 100 : 0;
              return (
                <button
                  key={store.id}
                  onClick={() => navigate('/', { state: { selectedStoreId: store.id } })}
                  className="w-full bg-bo-card rounded-2xl border border-bo-border p-4 hover:border-bo-accent/30 hover:shadow-card transition-all text-left group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-bold text-bo-text group-hover:text-bo-accent transition-colors">{store.name}</p>
                      <p className="text-[10px] text-bo-muted font-mono">{store.storeCode} {store.city && `— ${store.city}`}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-bo-text">{fmt(store.totalRevenue)}</p>
                      <p className="text-[10px] text-bo-muted">{store.totalSales} tickets</p>
                    </div>
                  </div>
                  {/* Revenue bar */}
                  <div className="w-full bg-bo-subtle rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-bo-accent rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-bo-muted">
                      Aujourd'hui: {fmt(store.todayRevenue)} ({store.todaySales} ticket{store.todaySales > 1 ? 's' : ''})
                    </span>
                    <ArrowRight size={14} className="text-bo-muted group-hover:text-bo-accent transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Ranking sidebar */}
        <div>
          <h2 className="text-lg font-bold text-bo-text mb-4 flex items-center gap-2">
            <Trophy size={18} className="text-amber-500" />
            Classement
          </h2>
          <div className="bg-bo-card rounded-2xl border border-bo-border p-4 space-y-3">
            {ranking.map((r) => (
              <div key={r.storeId} className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black ${
                  r.rank === 1 ? 'bg-amber-100 text-amber-700' :
                  r.rank === 2 ? 'bg-gray-100 text-gray-600' :
                  r.rank === 3 ? 'bg-orange-100 text-orange-600' :
                  'bg-bo-subtle text-bo-muted'
                }`}>
                  {r.rank}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-bo-text truncate">{r.name}</p>
                </div>
                <p className="text-xs font-bold text-bo-text">{fmt(r.totalRevenue)}</p>
              </div>
            ))}
            {ranking.length === 0 && (
              <p className="text-xs text-bo-muted text-center py-4">Aucune donnée</p>
            )}
          </div>

          {/* Excluded stores */}
          {data.excludedStores.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-bold text-bo-muted mb-2 flex items-center gap-1.5">
                <AlertTriangle size={12} />
                Exclus du consolidé
              </h3>
              <div className="space-y-1">
                {data.excludedStores.map((s) => (
                  <div key={s.id} className="text-[10px] text-bo-muted bg-bo-subtle rounded-lg px-3 py-1.5">
                    {s.name} <span className="font-mono">{s.storeCode}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KPICard({ icon: Icon, label, value, sub, accent }: {
  icon: any; label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-5 ${accent ? 'bg-bo-accent text-white border-bo-accent' : 'bg-bo-card border-bo-border'}`}>
      <Icon size={20} className={accent ? 'text-white/70' : 'text-bo-muted'} />
      <p className={`text-2xl font-black mt-2 ${accent ? '' : 'text-bo-text'}`}>{value}</p>
      <p className={`text-xs font-medium mt-0.5 ${accent ? 'text-white/70' : 'text-bo-muted'}`}>{label}</p>
      {sub && <p className={`text-[10px] mt-0.5 ${accent ? 'text-white/50' : 'text-bo-muted'}`}>{sub}</p>}
    </div>
  );
}
