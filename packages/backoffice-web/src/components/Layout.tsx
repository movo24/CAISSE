import React, { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, FileBarChart, Settings, LogOut,
  ChevronDown, ChevronRight, Globe, Store as StoreIcon,
  AlertTriangle, Building2, Network, Plug, CreditCard, Tag, Warehouse,
  BarChart3, Users, ShieldAlert, Database, Wallet, CalendarClock, Undo2,
  Boxes, Coins, Ticket, ClipboardCheck, Factory,
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
  { path: '/catalog/variants', label: 'Variantes', icon: Boxes, minRole: 'manager', scope: 'store' },
  { path: '/catalog/store-prices', label: 'Prix magasin', icon: Coins, minRole: 'manager', scope: 'store' },
  { path: '/catalog/brands-suppliers', label: 'Marques & Fournisseurs', icon: Factory, minRole: 'manager', scope: 'store' },
  { path: '/promo-codes', label: 'Codes promo', icon: Ticket, minRole: 'manager', scope: 'store' },
  { path: '/pending-payments', label: 'Paiements à régulariser', icon: CreditCard, minRole: 'manager', scope: 'store' },
  { path: '/inventory-variance', label: 'Écarts inventaire', icon: ClipboardCheck, minRole: 'manager', scope: 'store' },
  { path: '/stock-alerts', label: 'Alertes Stock', icon: AlertTriangle, scope: 'store' },
  { path: '/labels', label: 'Etiquettes', icon: Tag, minRole: 'manager', scope: 'store' },
  { path: '/performance', label: 'Performance', icon: BarChart3, minRole: 'manager', scope: 'store' },

  // Couche 5 — Analyse
  { path: '/reports', label: 'Rapports', icon: FileBarChart, minRole: 'manager', scope: 'store' },
  { path: '/sales-guards', label: 'Garde-fous', icon: ShieldAlert, minRole: 'manager', scope: 'store' },
  { path: '/returns', label: 'Retours & Avoirs', icon: Undo2, minRole: 'manager', scope: 'store' },

  // Couche 4 — Équipes / RH
  { path: '/employees', label: 'Employés', icon: Users, minRole: 'manager', scope: 'store' },
  { path: '/payroll', label: 'Paie & heures', icon: Wallet, minRole: 'manager', scope: 'store' },
  { path: '/planning', label: 'Planning', icon: CalendarClock, minRole: 'manager', scope: 'store' },
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
    { path: '/airtable-ops', label: 'Airtable Ops', icon: Database },
  ],
};

const bottomItems: NavItem[] = [
  { path: '/billing', label: 'Abonnement', icon: CreditCard, minRole: 'admin', scope: 'both' },
  { path: '/settings', label: 'Réglages', icon: Settings, scope: 'store' },
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
        className={`ai-nav-item ${indent ? 'pl-9 pr-3' : ''} ${isActive ? 'active' : ''}`}
      >
        <Icon size={indent ? 15 : 18} strokeWidth={isActive ? 2 : 1.5} />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <div className="min-h-screen flex">
      {/* ══════ Sidebar — Glass Apple Intelligence ══════ */}
      <aside
        className="w-[260px] flex flex-col fixed inset-y-0 left-0 z-20"
        style={{
          background: 'var(--bo-sidebar)',
          backdropFilter: 'var(--blur-lg)',
          WebkitBackdropFilter: 'var(--blur-lg)',
          borderRight: '1px solid var(--bo-border)',
        }}
      >
        {/* App Icon — click to return to dashboard */}
        <button
          onClick={() => navigate(appScope.isGlobal ? '/network' : '/')}
          className="flex items-center gap-3 px-5 py-4 w-full transition-all"
          style={{ borderBottom: '1px solid var(--bo-border)' }}
        >
          <div className="ai-halo relative">
            <img
              src="/icons/app-icon.png"
              alt="AddX Intelligence"
              className="w-10 h-10 rounded-2xl relative z-[1]"
              style={{ boxShadow: 'var(--shadow-sm)' }}
            />
          </div>
          <div className="text-left">
            <p className="ai-text font-bold text-[15px] tracking-tight">AddX Intelligence</p>
            <p className="text-[10px] font-medium" style={{ color: 'var(--bo-subtle-text)' }}>
              Back-Office
            </p>
          </div>
        </button>

        {/* ══════ Scope Switcher ══════ */}
        {appScope.isAdmin && appScope.stores.length > 0 && (
          <div className="px-3 py-3" style={{ borderBottom: '1px solid var(--bo-border)' }}>
            {/* Global button */}
            <button
              onClick={() => { appScope.switchToGlobal(); navigate('/network'); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all mb-1.5 ${
                appScope.isGlobal ? 'ai-border' : ''
              }`}
              style={
                appScope.isGlobal
                  ? { color: 'var(--bo-text)', background: 'var(--ai-gradient-soft)' }
                  : { color: 'var(--bo-muted)' }
              }
              onMouseEnter={(e) => {
                if (!appScope.isGlobal)
                  (e.currentTarget as HTMLElement).style.background = 'rgba(15,15,25,0.04)';
              }}
              onMouseLeave={(e) => {
                if (!appScope.isGlobal)
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <Globe size={14} />
              <span>Vue Globale</span>
            </button>

            {/* Store buttons */}
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {appScope.stores.filter((s) => (s as any).isActive !== false).map((store) => {
                const selected = appScope.selectedStoreId === store.id;
                return (
                  <button
                    key={store.id}
                    onClick={() => { appScope.switchToStore(store.id); navigate('/'); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all"
                    style={{
                      color: selected ? 'var(--bo-text)' : 'var(--bo-muted)',
                      background: selected ? 'rgba(255,255,255,0.8)' : 'transparent',
                      fontWeight: selected ? 600 : 400,
                      boxShadow: selected ? 'var(--shadow-sm)' : 'none',
                    }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background: selected
                          ? 'var(--ai-gradient)'
                          : 'rgba(15,15,25,0.2)',
                      }}
                    />
                    <span className="truncate">{store.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ══════ Navigation ══════ */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.filter(shouldShowItem).map((item) => renderNavItem(item))}

          {/* Administration group — admin only */}
          {hasRole(employee?.role, adminGroup.minRole) && (
            <div className="pt-2">
              <button
                onClick={() => setAdminOpen(!adminOpen)}
                className={`ai-nav-item w-full ${
                  adminGroup.items.some((i) => location.pathname === i.path) ? 'active' : ''
                }`}
              >
                <Network size={18} strokeWidth={1.5} />
                <span className="flex-1 text-left">{adminGroup.label}</span>
                {adminOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {adminOpen && (
                <div className="mt-0.5 space-y-0.5 ai-fade-in">
                  {adminGroup.items
                    .filter((i) => hasRole(employee?.role, i.minRole))
                    .map((item) => renderNavItem(item, true))}
                </div>
              )}
            </div>
          )}

          <hr className="ai-divider my-2" />

          {/* Bottom items */}
          {bottomItems.filter(shouldShowItem).map((item) => renderNavItem(item))}
        </nav>

        {/* ══════ Footer ══════ */}
        <div className="px-3 pb-4 space-y-3">
          {/* Current scope indicator — glass pill */}
          <div
            className="px-3 py-2.5 rounded-2xl text-center"
            style={{
              background: 'var(--ai-gradient-soft)',
              border: '1px solid var(--bo-border)',
            }}
          >
            <p
              className="text-[9px] uppercase tracking-[0.15em] font-semibold"
              style={{ color: 'var(--bo-subtle-text)' }}
            >
              {appScope.isGlobal ? 'Vue Réseau' : 'Magasin'}
            </p>
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--bo-text)' }}>
              {appScope.isGlobal ? 'Tous les magasins' : appScope.selectedStoreName || '—'}
            </p>
          </div>

          {/* User */}
          <div className="pt-2" style={{ borderTop: '1px solid var(--bo-border)' }}>
            <div className="flex items-center gap-2.5 pt-3">
              <div className="ai-halo relative">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center relative z-[1]"
                  style={{
                    background: 'var(--ai-gradient)',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <span className="text-white text-xs font-bold">{initials}</span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: 'var(--bo-text)' }}>
                  {displayName}
                </p>
                <p className="text-[10px] capitalize" style={{ color: 'var(--bo-subtle-text)' }}>
                  {employee?.role ?? ''}
                </p>
              </div>
              <button
                onClick={handleLogout}
                title="Déconnexion"
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl transition-all"
                style={{ color: 'var(--bo-muted)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(239,68,68,0.08)';
                  e.currentTarget.style.color = '#ef4444';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--bo-muted)';
                }}
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <span className="ai-sparkle" />
            <p className="text-center text-[10px]" style={{ color: 'var(--bo-subtle-text)' }}>
              CAISSE v0.3.0
            </p>
          </div>
        </div>
      </aside>

      {/* ══════ Main content ══════ */}
      <main className="flex-1 ml-[260px] overflow-auto min-h-screen">
        <div className="ai-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
