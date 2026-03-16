import React, { useState, useEffect, useCallback } from 'react';
import {
  CreditCard, Crown, Zap, Rocket, Star, Check, X, Loader2,
  ExternalLink, AlertTriangle, ArrowRight,
} from 'lucide-react';
import { subscriptionsApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';

interface PlanDef {
  name: string;
  priceMonthlyMinorUnits: number;
  priceYearlyMinorUnits: number;
  maxTerminals: number;
  maxProducts: number;
  maxEmployees: number;
  features: string[];
}

interface Usage {
  plan: string;
  status: string;
  products: { used: number; limit: number };
  employees: { used: number; limit: number };
  terminals: { used: number; limit: number };
  features: string[];
  billing: {
    priceMinorUnits: number;
    currencyCode: string;
    billingCycle: string;
    currentPeriodEnd: string;
  };
}

const PLAN_ICONS: Record<string, React.ReactNode> = {
  trial: <Star size={24} />,
  starter: <Zap size={24} />,
  business: <Rocket size={24} />,
  enterprise: <Crown size={24} />,
};

const PLAN_COLORS: Record<string, string> = {
  trial: 'border-gray-300 bg-gray-50',
  starter: 'border-blue-300 bg-blue-50',
  business: 'border-indigo-400 bg-indigo-50',
  enterprise: 'border-purple-400 bg-purple-50',
};

const FEATURE_LABELS: Record<string, string> = {
  pos_basic: 'Caisse de base',
  pos_dual_screen: 'Double ecran client',
  reports_basic: 'Rapports basiques',
  reports_full: 'Rapports complets',
  reports_export: 'Export rapports',
  promotions: 'Promotions',
  loyalty_basic: 'Fidelite basique',
  loyalty_full: 'Fidelite avancee',
  ia_pricing: 'IA Tarification',
  ia_forecast: 'IA Previsions',
  multi_currency: 'Multi-devise',
  stock_alerts: 'Alertes stock',
  api_access: 'Acces API',
  white_label: 'Marque blanche',
  priority_support: 'Support prioritaire',
  multi_store: 'Multi-magasin',
  audit_export: 'Export audit',
};

export function BillingPage() {
  const [plans, setPlans] = useState<Record<string, PlanDef>>({});
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const employee = useAuthStore((s) => s.employee);
  const storeId = employee?.storeId;

  const loadData = useCallback(async () => {
    if (!storeId) return;
    try {
      const [plansRes, usageRes] = await Promise.all([
        subscriptionsApi.plans(),
        subscriptionsApi.usage(storeId),
      ]);
      setPlans(plansRes.data || {});
      setUsage(usageRes.data);
    } catch {
      setError('Impossible de charger les informations d\'abonnement.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleUpgrade = async (plan: string) => {
    if (!storeId) return;
    setUpgrading(plan);
    setError(null);

    try {
      const res = await subscriptionsApi.createCheckout(storeId, {
        plan,
        billingCycle,
        successUrl: `${window.location.origin}/billing?success=true`,
        cancelUrl: `${window.location.origin}/billing?cancelled=true`,
      });
      // Redirect to Stripe Checkout
      if (res.data?.url) {
        window.location.href = res.data.url;
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur lors de la redirection vers Stripe.');
      setUpgrading(null);
    }
  };

  const handlePortal = async () => {
    if (!storeId) return;
    try {
      const res = await subscriptionsApi.createPortal(
        storeId,
        `${window.location.origin}/billing`,
      );
      if (res.data?.url) {
        window.location.href = res.data.url;
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur portail Stripe.');
    }
  };

  const formatPrice = (minor: number) => {
    if (minor === 0) return 'Gratuit';
    return `${(minor / 100).toFixed(0)} \u20ac`;
  };

  const formatLimit = (n: number) => (n === -1 ? 'Illimite' : String(n));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={32} className="animate-spin text-bo-accent" />
      </div>
    );
  }

  const planOrder = ['trial', 'starter', 'business', 'enterprise'];
  const currentPlan = usage?.plan || 'trial';
  const currentIdx = planOrder.indexOf(currentPlan);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
          <CreditCard size={28} className="text-bo-accent" />
          Abonnement & Facturation
        </h1>
        <p className="text-sm text-bo-muted mt-1">
          Gerez votre plan et vos moyens de paiement
        </p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Current plan banner */}
      {usage && (
        <div className="mb-8 bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg font-bold text-bo-text">
                  Plan {plans[currentPlan]?.name || currentPlan}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  usage.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                  usage.status === 'trial' ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {usage.status === 'active' ? 'Actif' :
                   usage.status === 'trial' ? 'Essai' :
                   usage.status === 'past_due' ? 'Impaye' :
                   usage.status}
                </span>
              </div>
              <p className="text-sm text-bo-muted">
                {usage.billing.priceMinorUnits > 0
                  ? `${formatPrice(usage.billing.priceMinorUnits)} / ${usage.billing.billingCycle === 'yearly' ? 'an' : 'mois'}`
                  : 'Gratuit'}
                {usage.billing.currentPeriodEnd && (
                  <span className="ml-2">
                    — Renouvellement le {new Date(usage.billing.currentPeriodEnd).toLocaleDateString('fr-FR')}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={handlePortal}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-bo-accent border border-bo-accent/30 rounded-xl hover:bg-bo-accent/5 transition-colors"
            >
              <ExternalLink size={14} />
              Portail facturation
            </button>
          </div>

          {/* Usage bars */}
          <div className="grid grid-cols-3 gap-6 mt-6">
            {[
              { label: 'Produits', used: usage.products.used, limit: usage.products.limit },
              { label: 'Employes', used: usage.employees.used, limit: usage.employees.limit },
              { label: 'Terminaux', used: usage.terminals.used, limit: usage.terminals.limit },
            ].map(({ label, used, limit }) => (
              <div key={label}>
                <div className="flex justify-between text-xs text-bo-muted mb-1">
                  <span>{label}</span>
                  <span>{used} / {formatLimit(limit)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      limit !== -1 && used / limit > 0.9 ? 'bg-red-400' :
                      limit !== -1 && used / limit > 0.7 ? 'bg-amber-400' :
                      'bg-bo-accent'
                    }`}
                    style={{
                      width: limit === -1 ? '10%' : `${Math.min(100, (used / limit) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Billing cycle toggle */}
      <div className="flex items-center justify-center gap-3 mb-8">
        <button
          onClick={() => setBillingCycle('monthly')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            billingCycle === 'monthly' ? 'bg-bo-accent text-white' : 'bg-gray-100 text-bo-muted hover:bg-gray-200'
          }`}
        >
          Mensuel
        </button>
        <button
          onClick={() => setBillingCycle('yearly')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            billingCycle === 'yearly' ? 'bg-bo-accent text-white' : 'bg-gray-100 text-bo-muted hover:bg-gray-200'
          }`}
        >
          Annuel <span className="text-xs ml-1 opacity-75">-20%</span>
        </button>
      </div>

      {/* Plans grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        {planOrder.map((planKey, idx) => {
          const plan = plans[planKey];
          if (!plan) return null;
          const isCurrent = planKey === currentPlan;
          const isUpgrade = idx > currentIdx;
          const price = billingCycle === 'yearly' ? plan.priceYearlyMinorUnits : plan.priceMonthlyMinorUnits;

          return (
            <div
              key={planKey}
              className={`rounded-2xl border-2 p-6 transition-shadow hover:shadow-lg ${
                isCurrent ? 'border-bo-accent ring-2 ring-bo-accent/20' : PLAN_COLORS[planKey] || 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="text-bo-accent">{PLAN_ICONS[planKey]}</span>
                <h3 className="font-bold text-bo-text">{plan.name}</h3>
              </div>

              <div className="mb-4">
                <span className="text-3xl font-black text-bo-text">
                  {formatPrice(price)}
                </span>
                {price > 0 && (
                  <span className="text-sm text-bo-muted ml-1">
                    / {billingCycle === 'yearly' ? 'an' : 'mois'}
                  </span>
                )}
              </div>

              <div className="space-y-1.5 mb-6 text-sm text-bo-muted">
                <div>{formatLimit(plan.maxTerminals)} terminal{plan.maxTerminals !== 1 ? 'x' : ''}</div>
                <div>{formatLimit(plan.maxProducts)} produits</div>
                <div>{formatLimit(plan.maxEmployees)} employes</div>
              </div>

              <div className="space-y-1 mb-6">
                {plan.features.slice(0, 6).map((f) => (
                  <div key={f} className="flex items-center gap-2 text-xs text-bo-text">
                    <Check size={12} className="text-emerald-500 shrink-0" />
                    {FEATURE_LABELS[f] || f}
                  </div>
                ))}
                {plan.features.length > 6 && (
                  <div className="text-xs text-bo-muted pl-5">
                    +{plan.features.length - 6} autres
                  </div>
                )}
              </div>

              {isCurrent ? (
                <div className="w-full py-2.5 text-center text-sm font-semibold text-bo-accent bg-bo-accent/10 rounded-xl">
                  Plan actuel
                </div>
              ) : isUpgrade ? (
                <button
                  onClick={() => handleUpgrade(planKey)}
                  disabled={upgrading !== null}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-bo-accent rounded-xl hover:bg-bo-accent/90 disabled:opacity-50 transition-colors"
                >
                  {upgrading === planKey ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ArrowRight size={14} />
                  )}
                  Passer a {plan.name}
                </button>
              ) : (
                <div className="w-full py-2.5 text-center text-xs text-bo-muted rounded-xl border border-gray-200">
                  Plan inferieur
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
