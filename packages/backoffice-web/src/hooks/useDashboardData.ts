import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeSales } from './useRealtimeSales';
import {
  productsApi,
  // salesApi removed — using storesApi.networkSummary() instead (aggregated, fast)
  employeesApi,
  storesApi,
  reportsApi,
  notificationsApi,
} from '../services/api';
import { useAuthStore } from '../stores/authStore';

/* ── Types ── */

interface PerfData {
  caJour: number;
  caJourN1: number;
  caSemaine: number;
  caSemaineN1: number;
  caMois: number;
  caMoisN1: number;
  caAnnee: number;
  caAnneeN1: number;
  panierMoyen: number;
  panierMoyenN1: number;
  ticketsJour: number;
  ticketsJourN1: number;
  ticketsSemaine: number;
  ticketsMois: number;
  surfaceM2: number;
  nbEmployes: number;
  objectifMois: number;
  tauxTransformation: number;
  tauxTransformationN1: number;
  hourlyCA: { h: string; ca: number }[];
  weekActual: number[];
  weekAvg: number[];
  weeklyObjective: number;
  monthlyCA: number[];
  monthlyCAN1: number[];
}

interface Product {
  rank: number;
  name: string;
  ean: string;
  qty: number;
  ca: number;
  marge: number;
  stock: number;
  lastSale?: string;
}

interface StockAlert {
  productId: string;
  name: string;
  ean: string;
  stock: number;
  seuil: number;
  level: 'alert' | 'critical' | 'out_of_stock';
  message: string;
}

interface CashierPerf {
  name: string;
  tickets: number;
  ca: number;
  vitesseMoy: number;
  annulations: number;
  remboursements: number;
  ecart: number;
}

interface CashierCashControl {
  name: string;
  totalCA: number;
  especesCA: number;
  tauxEspeces: number;
  tickets: number;
  annulations: number;
  remboursements: number;
  ticketsSupprimes: number;
  ecartCaisse: number;
  vitesseMoy: number;
  heuresCreuses: boolean;
  tendance7j: number[];
  magasin: string;
}

export interface DashboardData {
  loading: boolean;
  perfData: PerfData;
  topProducts: Product[];
  flopProducts: Product[];
  productCategories: { name: string; ca: number; pct: number }[];
  stockAlerts: StockAlert[];
  dormantProducts: { name: string; lastSale: string; stock: number; valeurStock: number }[];
  productStats: {
    margeBruteGlobale: number;
    margeBruteN1: number;
    rotationStock: number;
    rupturesActuelles: number;
    produitsDormants: number;
    nbReferences: number;
  };
  cashierData: CashierPerf[];
  caisseStats: {
    vitesseMoyenne: number;
    vitesseMin: number;
    vitesseMax: number;
    ticketsAnnules: number;
    totalRemboursements: number;
    ecartCaisseTotal: number;
    rapportZAuto: boolean;
  };
  zReports: any[];
  paymentData: {
    cb: { montant: number; pct: number; count: number };
    especes: { montant: number; pct: number; count: number };
    mixte: { montant: number; pct: number; count: number };
    cbRefuses: number;
    ticketsOfferts: number;
    montantOffert: number;
    reductionsTotales: number;
    pctReductions: number;
    tvaCollectee: number;
    tva20: number;
    tva10: number;
    tva55: number;
  };
  aiInsights: {
    tendances: { label: string; type: 'positive' | 'negative' }[];
    compaSemaine: { caActuel: number; caSemPrecedente: number; variation: string; positive: boolean };
    anomalies: { severity: 'high' | 'medium' | 'low'; message: string }[];
    actionsConcretes: { priority: string; action: string; impact: string; color: string }[];
    previsionCA: { demain: number; semaine: number; mois: number; confiance: number };
    objectifDynamique: { jourSuggere: number; semaineSuggere: number; moisSuggere: number; justification: string };
  };
  cashierCashControl: CashierCashControl[];
  cashControlAlertHistory: { date: string; caissier: string; type: string; score: number; statut: 'En cours' | 'Resolu' | 'Archive' }[];
  interStoreComparison: { magasin: string; tauxEspeces: number; ecartMoyen: number; annulationsPct: number }[];
  stores: { id: string; name: string }[];
  refresh: () => void;
}

/* ── Defaults (all zeros / empty) ── */

const emptyPerf: PerfData = {
  caJour: 0, caJourN1: 0, caSemaine: 0, caSemaineN1: 0,
  caMois: 0, caMoisN1: 0, caAnnee: 0, caAnneeN1: 0,
  panierMoyen: 0, panierMoyenN1: 0,
  ticketsJour: 0, ticketsJourN1: 0, ticketsSemaine: 0, ticketsMois: 0,
  surfaceM2: 0, nbEmployes: 0, objectifMois: 0,
  tauxTransformation: 0, tauxTransformationN1: 0,
  hourlyCA: [], weekActual: [0, 0, 0, 0, 0, 0, 0],
  weekAvg: [0, 0, 0, 0, 0, 0, 0], weeklyObjective: 0,
  monthlyCA: Array(12).fill(0), monthlyCAN1: Array(12).fill(0),
};

const emptyPayment = {
  cb: { montant: 0, pct: 0, count: 0 },
  especes: { montant: 0, pct: 0, count: 0 },
  mixte: { montant: 0, pct: 0, count: 0 },
  cbRefuses: 0, ticketsOfferts: 0, montantOffert: 0,
  reductionsTotales: 0, pctReductions: 0,
  tvaCollectee: 0, tva20: 0, tva10: 0, tva55: 0,
};

const emptyAiInsights = {
  tendances: [] as { label: string; type: 'positive' | 'negative' }[],
  compaSemaine: { caActuel: 0, caSemPrecedente: 0, variation: '—', positive: true },
  anomalies: [] as { severity: 'high' | 'medium' | 'low'; message: string }[],
  actionsConcretes: [] as { priority: string; action: string; impact: string; color: string }[],
  previsionCA: { demain: 0, semaine: 0, mois: 0, confiance: 0 },
  objectifDynamique: { jourSuggere: 0, semaineSuggere: 0, moisSuggere: 0, justification: '' },
};

/* ── Date helpers ── */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/* ── Hook ── */

export function useDashboardData(): DashboardData {
  const employee = useAuthStore((s) => s.employee);
  const { currentStoreId } = useAuthStore();
  const storeId = currentStoreId || employee?.storeId || '';

  const [loading, setLoading] = useState(true);
  const [perfData, setPerfData] = useState<PerfData>(emptyPerf);
  const [topProducts, setTopProducts] = useState<Product[]>([]);
  const [flopProducts, setFlopProducts] = useState<Product[]>([]);
  const [productCategories, setProductCategories] = useState<{ name: string; ca: number; pct: number }[]>([]);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [dormants, setDormants] = useState<{ name: string; lastSale: string; stock: number; valeurStock: number }[]>([]);
  const [productStats, setProductStats] = useState({
    margeBruteGlobale: 0, margeBruteN1: 0, rotationStock: 0,
    rupturesActuelles: 0, produitsDormants: 0, nbReferences: 0,
  });
  const [cashierData, setCashierData] = useState<CashierPerf[]>([]);
  const [caisseStats, setCaisseStats] = useState({
    vitesseMoyenne: 0, vitesseMin: 0, vitesseMax: 0,
    ticketsAnnules: 0, totalRemboursements: 0, ecartCaisseTotal: 0, rapportZAuto: true,
  });
  const [zReports, setZReports] = useState<any[]>([]);
  const [paymentData, setPaymentData] = useState(emptyPayment);
  const [aiInsights, setAiInsights] = useState(emptyAiInsights);
  const [cashierCashControl, setCashierCashControl] = useState<CashierCashControl[]>([]);
  const [cashControlAlertHistory, setCashControlAlertHistory] = useState<any[]>([]);
  const [interStoreComparison, setInterStoreComparison] = useState<any[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);

  const fetchAll = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);

    try {
      // Fetch in parallel — use daily-summary for STORE-scoped KPIs (not networkSummary which is global)
      const today = new Date().toISOString().split('T')[0];
      const [
        productsRes,
        stockAlertsRes,
        dailySummaryRes,
        networkRes,
        storesRes,
        analyticsRes,
      ] = await Promise.allSettled([
        productsApi.list({ storeId }),
        notificationsApi.stockAlerts(storeId),
        reportsApi.storeKpi(storeId, today),  // STORE-scoped KPIs (CA jour, tickets, panier moyen)
        storesApi.networkSummary(),  // aggregated network KPIs (for comparison only)
        storesApi.list(),
        reportsApi.productAnalytics(storeId),  // top/flop/dormant + réassort (dérivé des ventes)
      ]);

      // ── Products ── (la réponse peut être un tableau OU {data:[...]})
      const productsRaw = productsRes.status === 'fulfilled' ? productsRes.value.data : [];
      const products = Array.isArray(productsRaw) ? productsRaw : (productsRaw?.data ?? []);
      setProductStats((prev) => ({ ...prev, nbReferences: products.length }));

      // Derive stock alerts from notifications API
      if (stockAlertsRes.status === 'fulfilled') {
        const notifications: any[] = stockAlertsRes.value.data || [];
        const list: StockAlert[] = notifications.map((n: any) => ({
          productId: n.productId,
          name: n.productName,
          ean: n.ean,
          stock: n.stockQuantity,
          seuil: n.alertThreshold,
          level: n.level,
          message: n.message,
        }));
        setAlerts(list);
        const ruptureCount = list.filter((a) => a.level === 'critical' || a.level === 'out_of_stock').length;
        setProductStats((prev) => ({ ...prev, rupturesActuelles: ruptureCount }));
      }

      // ── Store-scoped KPIs from daily-summary (filtered by storeId) ──
      if (dailySummaryRes.status === 'fulfilled') {
        const summary = dailySummaryRes.value.data || {};
        const todayCA = summary.totalRevenueMinorUnits || summary.todayRevenue || 0;
        const todaySales = summary.transactionCount || summary.todaySales || 0;
        const avgBasket = todaySales > 0 ? Math.round(todayCA / todaySales) : 0;

        setPerfData((prev) => ({
          ...prev,
          caJour: todayCA,
          ticketsJour: todaySales,
          panierMoyen: avgBasket,
        }));
      }

      // ── Network Summary (global aggregation — for comparison/total only) ──
      if (networkRes.status === 'fulfilled') {
        const net = networkRes.value.data?.network || {};
        setPerfData((prev) => ({
          ...prev,
          caTotal: net.totalRevenue || 0,
          ticketsTotal: net.totalSales || 0,
        }));
      }

      // ── Employees — migrated to TimeWin24, skip ──

      // ── Stores ──
      if (storesRes.status === 'fulfilled') {
        const storeList: any[] = storesRes.value.data || [];
        setStores(storeList.map((s: any) => ({ id: s.id, name: s.name || s.storeName || 'Magasin' })));
        setPerfData((prev) => ({
          ...prev,
          surfaceM2: storeList.find((s: any) => s.id === storeId)?.surfaceM2 || 0,
        }));
        // Comparaison inter-magasins : pas encore alimentée par de vraies
        // métriques → on n'affiche PAS de valeurs factices (zéros trompeurs).
        setInterStoreComparison([]);
      }

      // ── Analyse produit (top/flop/dormant/réassort) dérivée des ventes ──
      if (analyticsRes.status === 'fulfilled') {
        const a = analyticsRes.value.data || {};
        const toProduct = (i: any, idx: number) => ({
          rank: idx + 1,
          name: i.name,
          ean: i.ean || '',
          qty: i.unitsSold30d,
          ca: i.revenue30dMinorUnits ?? 0,
          marge: i.marginPct ?? 0,
          stock: i.stockQuantity,
          lastSale: i.lastSoldAt ? new Date(i.lastSoldAt).toLocaleDateString('fr-FR') : '—',
        });
        setTopProducts((a.top || []).map(toProduct));
        setFlopProducts((a.flop || []).map(toProduct));

        const dormantList = (a.dormant || []).map((d: any) => ({
          name: d.name,
          lastSale: d.lastSoldAt ? new Date(d.lastSoldAt).toLocaleDateString('fr-FR') : 'Jamais vendu',
          stock: d.stockQuantity,
          valeurStock: d.valeurStockMinorUnits,
        }));
        setDormants(dormantList);

        // Stats produit réelles (fin des champs undefined / 0 figés)
        const items: any[] = a.items || [];
        const withMargin = items.filter((i) => i.marginPct != null && i.revenue30dMinorUnits > 0);
        const totRev = withMargin.reduce((s, i) => s + i.revenue30dMinorUnits, 0);
        const margeBrute = totRev > 0
          ? Math.round(withMargin.reduce((s, i) => s + i.revenue30dMinorUnits * i.marginPct, 0) / totRev)
          : 0;
        const totUnits = items.reduce((s, i) => s + i.unitsSold30d, 0);
        const totStock = items.reduce((s, i) => s + i.stockQuantity, 0);
        const rotation = totStock > 0 ? Math.round((totUnits / totStock) * 10) / 10 : 0;
        setProductStats((prev) => ({
          ...prev,
          produitsDormants: dormantList.length,
          margeBruteGlobale: margeBrute,
          margeBruteN1: margeBrute,
          rotationStock: rotation,
        }));
      }

      // Network / Live performance → migrated to TimeWin24
      // AI Insights → migrated to TimeWin24
    } catch (err) {
      console.error('[Dashboard] Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    fetchAll();
    // Slow fallback refresh — real-time SSE below drives freshness now (was 30s).
    const interval = setInterval(fetchAll, 120_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Real-time: refresh on live sale events (debounced to coalesce bursts).
  const rtTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtimeSales(storeId, () => {
    if (rtTimer.current) clearTimeout(rtTimer.current);
    rtTimer.current = setTimeout(() => fetchAll(), 800);
  });

  return {
    loading,
    perfData,
    topProducts,
    flopProducts,
    productCategories,
    stockAlerts: alerts,
    dormantProducts: dormants,
    productStats,
    cashierData,
    caisseStats,
    zReports,
    paymentData,
    aiInsights,
    cashierCashControl,
    cashControlAlertHistory,
    interStoreComparison,
    stores,
    refresh: fetchAll,
  };
}
