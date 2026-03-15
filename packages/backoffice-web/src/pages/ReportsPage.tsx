import React, { useState } from 'react';
import {
  Calendar,
  FileText,
  TrendingUp,
  ShoppingCart,
  Target,
  CreditCard,
  Banknote,
  ReceiptText,
  ArrowDown,
  ArrowUp,
  Download,
  Printer,
  Clock,
  Trophy,
  Percent,
  XCircle,
} from 'lucide-react';

export function ReportsPage() {
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0],
  );
  const [activeTab, setActiveTab] = useState<'z-report' | 'analytics'>('z-report');

  // MVP: Static Z-report display
  const zReport = {
    date: selectedDate,
    totalRevenue: 1245.8,
    totalTax: 207.63,
    cashTotal: 485.6,
    cardTotal: 760.2,
    transactionCount: 42,
    avgBasket: 29.66,
    voidCount: 2,
    discountTotal: 45.5,
    topProducts: [
      { name: 'T-Shirt Blanc', qty: 15, revenue: 448.5 },
      { name: 'Jean Slim Noir', qty: 8, revenue: 479.2 },
      { name: 'Chaussettes', qty: 22, revenue: 195.8 },
      { name: 'Casquette Sport', qty: 6, revenue: 119.4 },
      { name: 'Echarpe Laine', qty: 4, revenue: 139.6 },
    ],
    peakHours: [
      { hour: '09h', count: 3 },
      { hour: '10h', count: 5 },
      { hour: '11h', count: 8 },
      { hour: '12h', count: 4 },
      { hour: '13h', count: 3 },
      { hour: '14h', count: 9 },
      { hour: '15h', count: 7 },
      { hour: '16h', count: 4 },
      { hour: '17h', count: 2 },
    ],
    comparison: {
      revenueChange: +12.5,
      transactionChange: +8.2,
      basketChange: -2.1,
    },
  };

  const maxCount = Math.max(...zReport.peakHours.map((h) => h.count));
  const cardPercent = Math.round((zReport.cardTotal / zReport.totalRevenue) * 100);
  const cashPercent = 100 - cardPercent;

  const formatCurrency = (n: number) =>
    n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20ac';

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-bo-text">Rapports</h2>
          <p className="text-gray-400 mt-1 text-sm">Analyse des ventes et cloture de journee</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="date"
              className="pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <Printer size={16} />
            Imprimer
          </button>
          <button className="flex items-center gap-2 bg-bo-accent text-white px-5 py-2.5 rounded-xl font-medium hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/25">
            <FileText size={16} />
            Generer Z-Report
          </button>
        </div>
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[
          { id: 'z-report' as const, label: 'Rapport Z', icon: ReceiptText },
          { id: 'analytics' as const, label: 'Analytique', icon: TrendingUp },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-bo-text shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'z-report' ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              {
                label: "Chiffre d'affaires",
                value: formatCurrency(zReport.totalRevenue),
                icon: TrendingUp,
                color: 'text-bo-accent bg-indigo-50',
                change: zReport.comparison.revenueChange,
              },
              {
                label: 'Transactions',
                value: String(zReport.transactionCount),
                icon: ShoppingCart,
                color: 'text-emerald-600 bg-emerald-50',
                change: zReport.comparison.transactionChange,
              },
              {
                label: 'Panier moyen',
                value: formatCurrency(zReport.avgBasket),
                icon: Target,
                color: 'text-amber-600 bg-amber-50',
                change: zReport.comparison.basketChange,
              },
              {
                label: 'TVA collectee',
                value: formatCurrency(zReport.totalTax),
                icon: Percent,
                color: 'text-cyan-600 bg-cyan-50',
                change: null,
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100/50"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${card.color}`}>
                      <Icon size={18} />
                    </div>
                    {card.change !== null && (
                      <span
                        className={`flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full ${
                          card.change >= 0
                            ? 'text-emerald-600 bg-emerald-50'
                            : 'text-red-500 bg-red-50'
                        }`}
                      >
                        {card.change >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                        {Math.abs(card.change)}%
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-bold text-bo-text">{card.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{card.label}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Payment breakdown */}
            <div className="bg-white rounded-2xl p-6 shadow-soft border border-gray-100/50">
              <h3 className="font-semibold text-bo-text mb-5 flex items-center gap-2">
                <CreditCard size={16} className="text-bo-accent" />
                Moyens de paiement
              </h3>

              {/* Donut-style summary */}
              <div className="flex items-center gap-6 mb-5">
                <div className="relative w-28 h-28 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="15.5" fill="none"
                      stroke="#6366f1" strokeWidth="3"
                      strokeDasharray={`${cardPercent} ${100 - cardPercent}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-bold text-bo-text">{cardPercent}%</span>
                    <span className="text-[10px] text-gray-400">Carte</span>
                  </div>
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-bo-accent" />
                      <span className="text-sm text-gray-600">Carte bancaire</span>
                    </div>
                    <span className="text-sm font-semibold">{formatCurrency(zReport.cardTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-emerald-500" />
                      <span className="text-sm text-gray-600">Especes</span>
                    </div>
                    <span className="text-sm font-semibold">{formatCurrency(zReport.cashTotal)}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-4 border-t border-gray-100">
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-2 text-gray-500">
                    <Percent size={13} className="text-amber-500" />
                    Remises totales
                  </span>
                  <span className="text-amber-600 font-semibold">-{formatCurrency(zReport.discountTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-2 text-gray-500">
                    <XCircle size={13} className="text-red-400" />
                    Annulations
                  </span>
                  <span className="text-red-500 font-semibold">{zReport.voidCount}</span>
                </div>
              </div>
            </div>

            {/* Peak hours */}
            <div className="bg-white rounded-2xl p-6 shadow-soft border border-gray-100/50">
              <h3 className="font-semibold text-bo-text mb-5 flex items-center gap-2">
                <Clock size={16} className="text-bo-accent" />
                Heures de pointe
              </h3>
              <div className="flex items-end gap-2 h-44">
                {zReport.peakHours.map((h) => {
                  const heightPct = (h.count / maxCount) * 100;
                  const isMax = h.count === maxCount;
                  return (
                    <div key={h.hour} className="flex-1 flex flex-col items-center gap-1.5 group">
                      <span className={`text-xs font-semibold transition-colors ${isMax ? 'text-bo-accent' : 'text-gray-400'}`}>
                        {h.count}
                      </span>
                      <div className="w-full relative flex items-end" style={{ height: '120px' }}>
                        <div
                          className={`w-full rounded-t-lg transition-all duration-500 ${
                            isMax
                              ? 'bg-gradient-to-t from-bo-accent to-indigo-400'
                              : 'bg-gradient-to-t from-indigo-200 to-indigo-100 group-hover:from-bo-accent/60 group-hover:to-indigo-300'
                          }`}
                          style={{ height: `${heightPct}%`, minHeight: '6px' }}
                        />
                      </div>
                      <span className={`text-[11px] font-medium ${isMax ? 'text-bo-accent' : 'text-gray-400'}`}>
                        {h.hour}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                <span>Heure la plus dense: 14h</span>
                <span className="text-bo-accent font-semibold">9 transactions</span>
              </div>
            </div>
          </div>

          {/* Top products */}
          <div className="bg-white rounded-2xl p-6 shadow-soft border border-gray-100/50">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-bo-text flex items-center gap-2">
                <Trophy size={16} className="text-amber-500" />
                Top produits de la journee
              </h3>
              <button className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-bo-accent transition-colors">
                <Download size={13} />
                Exporter CSV
              </button>
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-100">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50/50">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider w-8">#</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Produit</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Quantite</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Chiffre d'affaires</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Part</th>
                  </tr>
                </thead>
                <tbody>
                  {zReport.topProducts.map((p, i) => {
                    const share = Math.round((p.revenue / zReport.totalRevenue) * 100);
                    return (
                      <tr key={i} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4">
                          <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${
                            i === 0 ? 'bg-amber-100 text-amber-700' :
                            i === 1 ? 'bg-gray-100 text-gray-600' :
                            i === 2 ? 'bg-orange-100 text-orange-600' :
                            'bg-gray-50 text-gray-400'
                          }`}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-medium text-sm text-bo-text">{p.name}</td>
                        <td className="py-3 px-4 text-right text-sm">
                          <span className="bg-indigo-50 text-bo-accent text-xs font-semibold px-2.5 py-1 rounded-lg">
                            {p.qty} vendus
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-sm">{formatCurrency(p.revenue)}</td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-bo-accent rounded-full"
                                style={{ width: `${share}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 font-medium w-8 text-right">{share}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* Analytics tab - placeholder */
        <div className="bg-white rounded-2xl p-12 shadow-soft border border-gray-100/50 text-center">
          <TrendingUp size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-semibold text-bo-text mb-2">Analytique avancee</h3>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            Connectez le backend pour acceder aux analyses avancees : tendances mensuelles,
            comparaisons inter-magasins, predictions de ventes et rapports personnalises.
          </p>
          <button className="mt-6 px-6 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-medium hover:bg-bo-accent/90 transition-colors shadow-lg shadow-bo-accent/25">
            Configurer la connexion
          </button>
        </div>
      )}
    </div>
  );
}
