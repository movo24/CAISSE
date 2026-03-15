import { useState, useEffect, useCallback } from 'react';
import {
  Trophy, Activity, TrendingUp, AlertTriangle,
  ShoppingCart, Users, Sparkles, RefreshCw, Loader2,
} from 'lucide-react';
import { livePerformanceApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';

/* ═══════════════════════════════════════════════════════════════
   LivePerformancePage — Dashboard multi-store réseau
   Classement, KPIs réseau, alertes, et suggestions IA
   ═══════════════════════════════════════════════════════════════ */

// ── Types ──

interface TopProduct {
  name: string;
  quantity: number;
}

interface StorePerformance {
  storeId: string;
  storeName: string;
  rank: number;
  todayRevenue: number;
  todayTransactions: number;
  avgBasket: number;
  currentHourRevenue: number;
  currentHourTransactions: number;
  lastSaleAt: string | null;
  isInactive: boolean;
  topProducts: TopProduct[];
}

interface NetworkSnapshot {
  networkId: string;
  stores: StorePerformance[];
  totalNetworkRevenue: number;
  generatedAt: string;
}

// ── Helpers ──

function formatEuros(minorUnits: number): string {
  return (minorUnits / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20ac';
}

function formatEurosShort(minorUnits: number): string {
  return (minorUnits / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20ac';
}

function rankEmoji(rank: number): string {
  if (rank === 1) return '\ud83e\udd47';
  if (rank === 2) return '\ud83e\udd48';
  if (rank === 3) return '\ud83e\udd49';
  return `${rank}e`;
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'à l\'instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `il y a ${hours}h`;
}

// ── Simple Markdown (same as AssistantPage) ──

function InlineFormat({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={i} className="bg-indigo-50 text-indigo-700 px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key++} className="list-disc pl-5 my-2 space-y-1">
          {listItems.map((item, i) => (
            <li key={i} className="text-sm text-gray-700"><InlineFormat text={item} /></li>
          ))}
        </ul>,
      );
      listItems = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flushList(); continue; }
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(<h2 key={key++} className="text-base font-bold text-gray-900 mt-4 mb-2 pb-1.5 border-b border-indigo-100"><InlineFormat text={trimmed.slice(3)} /></h2>);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(<h3 key={key++} className="text-sm font-bold text-gray-800 mt-3 mb-1"><InlineFormat text={trimmed.slice(4)} /></h3>);
      continue;
    }
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      flushList();
      elements.push(<h1 key={key++} className="text-lg font-bold text-gray-900 mt-4 mb-2"><InlineFormat text={trimmed.slice(2)} /></h1>);
      continue;
    }
    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*]\s/, '').replace(/^\d+\.\s/, ''));
      continue;
    }
    flushList();
    elements.push(<p key={key++} className="text-sm text-gray-700 my-1.5 leading-relaxed"><InlineFormat text={trimmed} /></p>);
  }
  flushList();
  return <div>{elements}</div>;
}

// ── Main Page ──

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 min

export function LivePerformancePage() {
  const [snapshot, setSnapshot] = useState<NetworkSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const { restoreSession } = useAuthStore();

  // Restore session from localStorage (login required via /login)
  useEffect(() => {
    restoreSession();
    const existingToken = localStorage.getItem('accessToken');
    setAuthReady(!!existingToken);
  }, []);

  const fetchSnapshot = useCallback(async () => {
    try {
      setLoading(true);
      const res = await livePerformanceApi.networkSnapshot();
      setSnapshot(res.data);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount + auto-refresh
  useEffect(() => {
    if (!authReady) return;
    fetchSnapshot();
    const iv = setInterval(fetchSnapshot, REFRESH_INTERVAL);
    return () => clearInterval(iv);
  }, [authReady, fetchSnapshot]);

  const fetchAiInsight = async () => {
    setAiLoading(true);
    try {
      const res = await livePerformanceApi.aiInsight();
      setAiInsight(res.data.insight);
    } catch {
      setAiInsight('Impossible de charger les suggestions IA.');
    } finally {
      setAiLoading(false);
    }
  };

  if (!authReady) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    );
  }

  const inactiveStores = snapshot?.stores.filter((s) => s.isInactive) ?? [];
  const bestStore = snapshot?.stores[0];
  const avgBasketNetwork = snapshot && snapshot.stores.length > 0
    ? Math.round(snapshot.stores.reduce((sum, s) => sum + s.avgBasket, 0) / snapshot.stores.length)
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center">
            <Activity size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              Performance Réseau
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                LIVE
              </span>
            </h1>
            <p className="text-sm text-gray-400">
              {snapshot ? `Réseau ${snapshot.networkId}` : 'Chargement...'}
              {snapshot && ` \u2022 Mis à jour à ${new Date(snapshot.generatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>
        </div>
        <button
          onClick={fetchSnapshot}
          disabled={loading}
          className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualiser
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      {snapshot && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            icon={TrendingUp}
            label="CA Total Réseau"
            value={formatEurosShort(snapshot.totalNetworkRevenue)}
            color="indigo"
          />
          <KpiCard
            icon={Trophy}
            label="Meilleur Magasin"
            value={bestStore?.storeName ?? '-'}
            sub={bestStore ? formatEurosShort(bestStore.todayRevenue) : ''}
            color="amber"
          />
          <KpiCard
            icon={ShoppingCart}
            label="Panier Moyen Réseau"
            value={formatEuros(avgBasketNetwork)}
            color="emerald"
          />
          <KpiCard
            icon={AlertTriangle}
            label="Alertes Actives"
            value={`${inactiveStores.length}`}
            sub={inactiveStores.length > 0 ? 'magasin(s) inactif(s)' : 'Tout est normal'}
            color={inactiveStores.length > 0 ? 'red' : 'emerald'}
          />
        </div>
      )}

      {/* Ranking Table */}
      {snapshot && snapshot.stores.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Trophy size={16} className="text-amber-500" />
              Classement des magasins
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/50 text-gray-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-5 py-3 font-semibold">Rang</th>
                  <th className="text-left px-5 py-3 font-semibold">Magasin</th>
                  <th className="text-right px-5 py-3 font-semibold">CA Jour</th>
                  <th className="text-right px-5 py-3 font-semibold">Transactions</th>
                  <th className="text-right px-5 py-3 font-semibold">Panier Moyen</th>
                  <th className="text-right px-5 py-3 font-semibold">CA/Heure</th>
                  <th className="text-center px-5 py-3 font-semibold">Statut</th>
                  <th className="text-left px-5 py-3 font-semibold">Top Produits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {snapshot.stores.map((store) => (
                  <tr
                    key={store.storeId}
                    className={`hover:bg-gray-50/50 transition-colors ${
                      store.isInactive ? 'bg-red-50/30' : ''
                    }`}
                  >
                    <td className="px-5 py-3 font-bold text-lg">
                      {rankEmoji(store.rank)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-semibold text-gray-900">{store.storeName}</div>
                      {store.lastSaleAt && (
                        <div className="text-[10px] text-gray-400">
                          Dernière vente: {timeAgo(store.lastSaleAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-900">
                      {formatEurosShort(store.todayRevenue)}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-600">
                      {store.todayTransactions}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-600">
                      {formatEuros(store.avgBasket)}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-600">
                      {formatEurosShort(store.currentHourRevenue)}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {store.isInactive ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                          <AlertTriangle size={9} />
                          Inactif
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                          Actif
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {store.topProducts.map((p, i) => (
                          <span
                            key={i}
                            className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded"
                          >
                            {p.name} ({p.quantity})
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AI Insight */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-500" />
            Suggestions IA
          </h2>
          <button
            onClick={fetchAiInsight}
            disabled={aiLoading}
            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {aiInsight ? 'Actualiser' : 'Obtenir des suggestions'}
          </button>
        </div>
        <div className="p-5">
          {aiLoading && !aiInsight && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" />
              Analyse en cours...
            </div>
          )}
          {aiInsight ? (
            <SimpleMarkdown text={aiInsight} />
          ) : !aiLoading ? (
            <p className="text-sm text-gray-400 text-center py-4">
              Cliquez sur "Obtenir des suggestions" pour une analyse IA personnalisée de votre réseau.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── KPI Card ──

const colorMap: Record<string, { bg: string; icon: string; text: string }> = {
  indigo:  { bg: 'bg-indigo-50',  icon: 'text-indigo-500',  text: 'text-indigo-600' },
  amber:   { bg: 'bg-amber-50',   icon: 'text-amber-500',   text: 'text-amber-600' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-500', text: 'text-emerald-600' },
  red:     { bg: 'bg-red-50',     icon: 'text-red-500',     text: 'text-red-600' },
};

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  const c = colorMap[color] ?? colorMap.indigo;
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center`}>
          <Icon size={18} className={c.icon} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
          <p className={`text-lg font-bold ${c.text} truncate`}>{value}</p>
          {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
        </div>
      </div>
    </div>
  );
}
