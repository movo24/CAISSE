import React, { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, FileBarChart, Settings, LogOut,
  ChevronDown, ChevronRight, Globe, Store as StoreIcon,
  AlertTriangle, Building2, Network, Plug, CreditCard, Tag, Warehouse,
  BarChart3, Users, Rocket,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useAppScope } from '../hooks/useAppScope';

/* ══════════════════════════════════════════════════════════════
   ARCHITECTURE PAR COUCHES METIER
   ══════════════════════════════════════════════════════════════
   Couche 1 — Pilotage global (scope=global)
   Couche 2 — Structure / Administration
   Couche 3 — Exploitation magasin (scope=store)
   Couche 5 — Analyse
   Couche 6 — Stock / Logistique
   Couche 7 — Reglages
   ══════════════════════════════════════════════════════════════ */

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  minRole?: 'cashier' | 'manager' | 'admin';
  /** Only show in this scope */
  scope?: 'global' | 'store' | 'both';
}

interface NavGroup {
  label: string;
  icon: React.ElementType;
  items: NavItem[];
  minRole?: 'cashier' | 'manager' | 'admin';
  scope?: 'global' | 'store' | 'both';
  defaultOpen?: boolean;
}

const ROLE_LEVEL: Record<string, number> = { cashier: 0, manager: 1, admin: 2 };

function hasRole(userRole: string | undefined, minRole?: string): boolean {
  if (!minRole) return true;
  return (ROLE_LEVEL[userRole || 'cashier'] ?? 0) >= (ROLE_LEVEL[minRole] ?? 0);
}

// ── Navigation structure by layer ──

const navItems: NavItem[] = [
  // Couche 1 — Pilotage
  { path: '/network', label: 'Vue Réseau', icon: Globe, minRole: 'admin', scope: 'global' },
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, scope: 'store' },

  // Couche 3 — Exploitation magasin
  { path: '/products', label: 'Produits', icon: Package, scope: 'store' },
  { path: '/stock-alerts', label: 'Alertes Stock', icon: AlertTriangle, scope: 'store' },
  { path: '/labels', label: 'Etiquettes', icon: Tag, minRole: 'manager', scope: 'store' },

  // Couche 5 — Analyse
  { path: '/reports', label: 'Rapports', icon: FileBarChart, minRole: 'manager', scope: 'store' },
];

const stockGroup: NavGroup = {
  label: 'Stock',
  icon: Warehouse,
  minRole: 'admin',
  scope: 'both',
  items: [
    { path: '/stock-alerts', label: 'Alertes', icon: AlertTriangle, scope: 'store' },
    { path: '/stock-network', label: 'Stock Réseau', icon: Warehouse, scope: 'global' },
  ],
};

const adminGroup: NavGroup = {
  label: 'Administration',
  icon: Network,
  minRole: 'admin',
  scope: 'both',
  items: [
    { path: '/organizations', label: 'Organisations', icon: Building2 },
    { path: '/units', label: 'Unités', icon: Building2 },
    { path: '/stores', label: 'Magasins', icon: StoreIcon },
    { path: '/connected-apps', label: 'Applications', icon: Plug },
  ],
};

const bottomItems: NavItem[] = [
  { path: '/billing', label: 'Abonnement', icon: CreditCard, minRole: 'admin', scope: 'both' },
  { path: '/settings', label: 'Réglages', icon: Settings, scope: 'store' },
  { path: '/timewin24', label: 'TimeWin24', icon: Rocket, scope: 'both' },
];

// ════════════════════════════════════════════════════════════════

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { employee, logout } = useAuthStore();
  const appScope = useAppScope();
  const [adminOpen, setAdminOpen] = useState(() =>
    adminGroup.items.some((i) => location.pathname === i.path),
  );

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const displayName = employee
    ? `${employee.firstName} ${employee.lastName}`
    : 'Utilisateur';
  const initials = employee
    ? `${employee.firstName?.[0] ?? ''}${employee.lastName?.[0] ?? ''}`.toUpperCase()
    : 'U';

  const shouldShowItem = (item: NavItem) => {
    if (!hasRole(employee?.role, item.minRole)) return false;
    if (!item.scope || item.scope === 'both') return true;
    return item.scope === appScope.scope;
  };

  const renderNavItem = (item: NavItem, indent = false) => {
    const Icon = item.icon;
    const isActive = location.pathname === item.path;
    return (
      <Link
        key={item.path}
        to={item.path}
        className={`flex items-center gap-3 ${indent ? 'pl-9 pr-3' : 'px-3'} py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
          isActive
            ? 'bg-bo-accent text-white shadow-lg shadow-bo-accent/25'
            : 'text-white/50 hover:text-white hover:bg-bo-sidebar-hover'
        }`}
      >
        <Icon size={indent ? 15 : 18} strokeWidth={isActive ? 2 : 1.5} />
        {item.label}
      </Link>
    );
  };

  return (
    <div className="min-h-screen flex">
      {/* ══════ Sidebar ══════ */}
      <aside className="w-[240px] bg-bo-sidebar flex flex-col fixed inset-y-0 left-0 z-20">
        {/* App Icon — click to return to dashboard */}
        <button
          onClick={() => navigate(appScope.isGlobal ? '/network' : '/')}
          className="flex items-center gap-3 px-4 py-3 border-b border-white/10 hover:bg-white/5 transition-colors w-full"
        >
          <img
            src="/icons/app-icon.png"
            alt="AddX Intelligence"
            className="w-9 h-9 rounded-xl"
          />
          <div className="text-left">
            <p className="text-white font-bold text-sm tracking-tight">AddX Intelligence</p>
            <p className="text-white/30 text-[10px]">Back-Office</p>
          </div>
        </button>

        {/* ══════ Scope Switcher ══════ */}
        {appScope.isAdmin && appScope.stores.length > 0 && (
          <div className="px-3 py-3 border-b border-white/10">
            {/* Global button */}
            <button
              onClick={() => { appScope.switchToGlobal(); navigate('/network'); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all mb-1 ${
                appScope.isGlobal
                  ? 'bg-bo-accent/20 text-bo-accent border border-bo-accent/30'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
            >
              <Globe size={14} />
              <span>Vue Globale</span>
            </button>

            {/* Store buttons */}
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {appScope.stores.filter(s => (s as any).isActive !== false).map((store) => (
                <button
                  key={store.id}
                  onClick={() => { appScope.switchToStore(store.id); navigate('/'); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all ${
                    appScope.selectedStoreId === store.id
                      ? 'bg-white/10 text-white font-semibold'
                      : 'text-white/40 hover:text-white/60 hover:bg-white/5'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    appScope.selectedStoreId === store.id ? 'bg-bo-accent' : 'bg-white/20'
                  }`} />
                  <span className="truncate">{store.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ══════ Navigation ══════ */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          {/* Main nav items (filtered by scope + role) */}
          {navItems.filter(shouldShowItem).map((item) => renderNavItem(item))}

          {/* Administration group — admin only */}
          {hasRole(employee?.role, adminGroup.minRole) && (
            <div className="pt-2">
              <button
                onClick={() => setAdminOpen(!adminOpen)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  adminGroup.items.some((i) => location.pathname === i.path)
                    ? 'text-white/80'
                    : 'text-white/50 hover:text-white hover:bg-bo-sidebar-hover'
                }`}
              >
                <Network size={18} strokeWidth={1.5} />
                <span className="flex-1 text-left">{adminGroup.label}</span>
                {adminOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {adminOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {adminGroup.items.filter((i) => hasRole(employee?.role, i.minRole)).map((item) => renderNavItem(item, true))}
                </div>
              )}
            </div>
          )}

          {/* Separator */}
          <div className="border-t border-white/5 my-2" />

          {/* Bottom items */}
          {bottomItems.filter(shouldShowItem).map((item) => renderNavItem(item))}
        </nav>

        {/* ══════ Footer ══════ */}
        <div className="px-3 pb-4 space-y-2">
          {/* Current scope indicator */}
          <div className="px-3 py-2 rounded-xl bg-white/5 text-center">
            <p className="text-[10px] text-white/30 uppercase tracking-widest">
              {appScope.isGlobal ? 'Vue Réseau' : 'Magasin'}
            </p>
            <p className="text-xs text-white/70 font-semibold truncate">
              {appScope.isGlobal ? 'Tous les magasins' : appScope.selectedStoreName || '—'}
            </p>
          </div>

          {/* User */}
          <div className="border-t border-white/10 pt-3 px-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <span className="text-white/70 text-xs font-bold">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white/80 text-xs font-semibold truncate">{displayName}</p>
                <p className="text-white/30 text-[10px]">{employee?.role ?? ''}</p>
              </div>
              <button
                onClick={handleLogout}
                title="Déconnexion"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/5 rounded-lg transition-colors -mr-2"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
          <p className="text-center text-[10px] text-white/20">CAISSE v0.3.0</p>
        </div>
      </aside>

      {/* ══════ Main content ══════ */}
      <main className="flex-1 ml-[240px] overflow-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
