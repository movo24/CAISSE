import { useState, useEffect, useCallback } from 'react';
import {
  productsApi,
  salesApi,
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

/* ── Helper: today's date string ── */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/* ── Hook ── */

export function useDashboardData(): DashboardData {
  const employee = useAuthStore((s) => s.employee);
  const storeId = employee?.storeId || '';

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
      // Fetch in parallel
      const [
        productsRes,
        stockAlertsRes,
        salesRes,
        employeesRes,
        storesRes,
      ] = await Promise.allSettled([
        productsApi.list(),
        notificationsApi.stockAlerts(storeId),
        salesApi.list(todayStr()),
        employeesApi.list(),
        storesApi.list(),
      ]);

      // ── Products ──
      const products = productsRes.status === 'fulfilled' ? productsRes.value.data : [];
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

      // ── Sales — aggregate today's data ──
      if (salesRes.status === 'fulfilled') {
        const sales: any[] = salesRes.value.data || [];
        const totalCA = sales.reduce((s: number, sale: any) => s + (sale.totalMinorUnits || 0), 0);
        const nbTickets = sales.length;
        const avgBasket = nbTickets > 0 ? Math.round(totalCA / nbTickets) : 0;

        // Hourly breakdown
        const hourlyMap: Record<string, number> = {};
        for (const sale of sales) {
          const h = new Date(sale.createdAt).getHours();
          const key = `${h}h`;
          hourlyMap[key] = (hourlyMap[key] || 0) + (sale.totalMinorUnits || 0);
        }
        const hourlyCA = Object.entries(hourlyMap)
          .map(([h, ca]) => ({ h, ca }))
          .sort((a, b) => parseInt(a.h) - parseInt(b.h));

        // Payment breakdown from sale payments
        let cbTotal = 0, cbCount = 0;
        let cashTotal = 0, cashCount = 0;
        let mixteTotal = 0, mixteCount = 0;
        for (const sale of sales) {
          const payments = sale.payments || [];
          const hasCash = payments.some((p: any) => p.method === 'cash');
          const hasCard = payments.some((p: any) => p.method === 'card');
          if (hasCash && hasCard) {
            mixteTotal += sale.totalMinorUnits || 0;
            mixteCount++;
          } else if (hasCard) {
            cbTotal += sale.totalMinorUnits || 0;
            cbCount++;
          } else {
            cashTotal += sale.totalMinorUnits || 0;
            cashCount++;
          }
        }
        const totalPayments = cbTotal + cashTotal + mixteTotal;
        setPaymentData({
          cb: { montant: cbTotal, pct: totalPayments > 0 ? Math.round(cbTotal / totalPayments * 1000) / 10 : 0, count: cbCount },
          especes: { montant: cashTotal, pct: totalPayments > 0 ? Math.round(cashTotal / totalPayments * 1000) / 10 : 0, count: cashCount },
          mixte: { montant: mixteTotal, pct: totalPayments > 0 ? Math.round(mixteTotal / totalPayments * 1000) / 10 : 0, count: mixteCount },
          cbRefuses: 0, ticketsOfferts: 0, montantOffert: 0,
          reductionsTotales: 0, pctReductions: 0,
          tvaCollectee: Math.round(totalCA * 0.2 / 1.2),
          tva20: Math.round(totalCA * 0.2 / 1.2),
          tva10: 0, tva55: 0,
        });

        setPerfData((prev) => ({
          ...prev,
          caJour: totalCA,
          ticketsJour: nbTickets,
          panierMoyen: avgBasket,
          hourlyCA,
        }));
      }

      // ── Employees ──
      if (employeesRes.status === 'fulfilled') {
        const emps: any[] = employeesRes.value.data || [];
        setPerfData((prev) => ({ ...prev, nbEmployes: emps.length }));
        // Build empty cashier perf (no perf data from backend yet)
        setCashierData(emps.map((e: any) => ({
          name: `${e.firstName} ${e.lastName}`,
          tickets: 0, ca: 0, vitesseMoy: 0,
          annulations: 0, remboursements: 0, ecart: 0,
        })));
        setCashierCashControl(emps.map((e: any) => ({
          name: `${e.firstName} ${e.lastName}`,
          totalCA: 0, especesCA: 0, tauxEspeces: 0,
          tickets: 0, annulations: 0, remboursements: 0,
          ticketsSupprimes: 0, ecartCaisse: 0, vitesseMoy: 0,
          heuresCreuses: false, tendance7j: [0, 0, 0, 0, 0, 0, 0],
          magasin: '—',
        })));
      }

      // ── Stores ──
      if (storesRes.status === 'fulfilled') {
        const storeList: any[] = storesRes.value.data || [];
        setStores(storeList.map((s: any) => ({ id: s.id, name: s.name || s.storeName || 'Magasin' })));
        setPerfData((prev) => ({
          ...prev,
          surfaceM2: storeList.find((s: any) => s.id === storeId)?.surfaceM2 || 0,
        }));
        setInterStoreComparison(storeList.map((s: any) => ({
          magasin: s.name || s.storeName || 'Magasin',
          tauxEspeces: 0,
          ecartMoyen: 0,
          annulationsPct: 0,
        })));
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
  }, [fetchAll]);

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
