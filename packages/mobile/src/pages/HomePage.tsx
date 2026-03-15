// ── HomePage ─────────────────────────────────────────────────────
// Dashboard with 4 action buttons + stock alerts summary
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ScanBarcode, ClipboardList, PackageCheck, Search,
  LogOut, AlertTriangle, TrendingDown, Store,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { stockApi } from '../services/api';

interface StockAlert {
  id: string;
  name: string;
  stockQuantity: number;
  stockAlertThreshold: number;
}

export function HomePage() {
  const navigate = useNavigate();
  const employee = useAuthStore((s) => s.employee);
  const storeInfo = useAuthStore((s) => s.storeInfo);
  const canModifyStock = useAuthStore((s) => s.canModifyStock);
  const logout = useAuthStore((s) => s.logout);

  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [criticals, setCriticals] = useState<StockAlert[]>([]);

  useEffect(() => {
    stockApi.alerts()
      .then((res) => {
        setAlerts(res.data?.alert || res.data?.alerts || []);
        setCriticals(res.data?.critical || res.data?.criticals || []);
      })
      .catch(() => {});
  }, []);

  const actions = [
    {
      label: 'Scanner',
      desc: 'Scanner un produit',
      icon: ScanBarcode,
      path: '/scan',
      color: 'from-violet-500 to-violet-600',
      show: true,
    },
    {
      label: 'Inventaire',
      desc: 'Comptage continu',
      icon: ClipboardList,
      path: '/inventory',
      color: 'from-blue-500 to-blue-600',
      show: canModifyStock(),
    },
    {
      label: 'Reception',
      desc: 'Reception marchandise',
      icon: PackageCheck,
      path: '/receiving',
      color: 'from-emerald-500 to-emerald-600',
      show: canModifyStock(),
    },
    {
      label: 'Recherche',
      desc: 'Chercher un produit',
      icon: Search,
      path: '/search',
      color: 'from-amber-500 to-amber-600',
      show: true,
    },
  ];

  return (
    <div className="px-4 pt-4 pb-6 safe-top">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-mobile-text">
            Bonjour, {employee?.firstName || 'Manager'}
          </h1>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Store size={13} className="text-mobile-muted" />
            <span className="text-xs text-mobile-muted font-medium">
              {storeInfo?.name || employee?.storeId}
            </span>
            <span className="text-[10px] text-mobile-accent bg-violet-50 px-2 py-0.5 rounded-full font-semibold capitalize">
              {employee?.role}
            </span>
          </div>
        </div>
        <button
          onClick={() => {
            logout();
            navigate('/login');
          }}
          className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-mobile-muted"
        >
          <LogOut size={18} />
        </button>
      </div>

      {/* ── Action grid ── */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {actions.filter((a) => a.show).map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.path}
              onClick={() => navigate(action.path)}
              className={`relative p-5 rounded-2xl bg-gradient-to-br ${action.color} text-white text-left shadow-card active:scale-[0.97] transition-transform`}
            >
              <Icon size={28} strokeWidth={1.8} className="mb-3 opacity-90" />
              <div className="text-base font-bold">{action.label}</div>
              <div className="text-xs text-white/70 mt-0.5">{action.desc}</div>
            </button>
          );
        })}
      </div>

      {/* ── Stock alerts ── */}
      {(criticals.length > 0 || alerts.length > 0) && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-mobile-text flex items-center gap-2">
            <AlertTriangle size={15} className="text-mobile-warning" />
            Alertes stock
          </h2>

          {/* Critical items */}
          {criticals.slice(0, 3).map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-100"
            >
              <TrendingDown size={16} className="text-red-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-900 truncate">{item.name}</p>
                <p className="text-xs text-red-600">
                  Stock: {item.stockQuantity} (seuil: {item.stockAlertThreshold})
                </p>
              </div>
            </div>
          ))}

          {/* Warning items */}
          {alerts.slice(0, 3).map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-100"
            >
              <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900 truncate">{item.name}</p>
                <p className="text-xs text-amber-600">
                  Stock: {item.stockQuantity} (seuil: {item.stockAlertThreshold})
                </p>
              </div>
            </div>
          ))}

          {(criticals.length > 3 || alerts.length > 3) && (
            <p className="text-xs text-mobile-muted text-center">
              +{Math.max(0, criticals.length - 3) + Math.max(0, alerts.length - 3)} autre(s) alerte(s)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
