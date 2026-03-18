import React, { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, FileBarChart, Settings, LogOut, Users,
  ChevronDown, ChevronRight, ShieldCheck, UsersRound, Clock, BarChart3, Calendar, Wallet,
  AlertTriangle, Building2, Store, Network, Plug, CreditCard, Rocket,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { AppSwitcher } from './AppSwitcher';
import { StoreSwitcher } from './StoreSwitcher';

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  minRole?: 'cashier' | 'manager' | 'admin';
}

interface NavGroup {
  label: string;
  icon: React.ElementType;
  items: NavItem[];
  minRole?: 'cashier' | 'manager' | 'admin';
}

const ROLE_LEVEL: Record<string, number> = {
  cashier: 0,
  manager: 1,
  admin: 2,
};

function hasRole(userRole: string | undefined, minRole?: string): boolean {
  if (!minRole) return true;
  return (ROLE_LEVEL[userRole || 'cashier'] ?? 0) >= (ROLE_LEVEL[minRole] ?? 0);
}

// ── POS Navigation ──
const posNavItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/products', label: 'Produits', icon: Package },
  { path: '/stock-alerts', label: 'Alertes Stock', icon: AlertTriangle },
  { path: '/employees', label: 'Employes', icon: Users, minRole: 'manager' },
];

const networkGroup: NavGroup = {
  label: 'Réseau',
  icon: Network,
  minRole: 'admin',
  items: [
    { path: '/organizations', label: 'Organisations', icon: Building2, minRole: 'admin' },
    { path: '/units', label: 'Unités', icon: Building2, minRole: 'admin' },
    { path: '/stores', label: 'Magasins', icon: Store, minRole: 'admin' },
    { path: '/connected-apps', label: 'Applications', icon: Plug, minRole: 'admin' },
  ],
};

const rhGroup: NavGroup = {
  label: 'RH / Equipe',
  icon: UsersRound,
  minRole: 'manager',
  items: [
    { path: '/rights', label: 'Droits', icon: ShieldCheck, minRole: 'admin' },
    { path: '/pointage', label: 'Pointage', icon: Clock, minRole: 'manager' },
    { path: '/performance', label: 'Performance', icon: BarChart3, minRole: 'manager' },
    { path: '/planning', label: 'Planning', icon: Calendar, minRole: 'manager' },
    { path: '/payroll', label: 'Paie', icon: Wallet, minRole: 'admin' },
  ],
};

const posNavBottom: NavItem[] = [
  { path: '/reports', label: 'Rapports', icon: FileBarChart, minRole: 'manager' },
  { path: '/billing', label: 'Abonnement', icon: CreditCard, minRole: 'admin' },
  { path: '/settings', label: 'Reglages', icon: Settings },
];

// ── TimeWin24 Navigation ──
const tw24NavItems: NavItem[] = [
  { path: '/timewin24', label: 'Accueil TimeWin24', icon: Rocket },
];

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { employee, logout, currentApp } = useAuthStore();
  const [networkOpen, setNetworkOpen] = useState(() =>
    networkGroup.items.some((i) => location.pathname === i.path),
  );
  const [rhOpen, setRhOpen] = useState(() =>
    rhGroup.items.some((i) => location.pathname === i.path),
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
  const roleLabel = employee?.role ?? '';

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

  const isPOS = currentApp === 'pos';

  return (
    <div className="min-h-screen flex" data-app={currentApp}>
      {/* Sidebar */}
      <aside className="w-[240px] bg-bo-sidebar flex flex-col fixed inset-y-0 left-0 z-20 transition-colors duration-300">
        {/* App Switcher (replaces static logo) */}
        <AppSwitcher />

        {/* Nav — conditional by app */}
        <nav className="flex-1 px-3 space-y-1">
          {isPOS ? (
            <>
              {posNavItems.filter((i) => hasRole(employee?.role, i.minRole)).map((item) => renderNavItem(item))}

              {/* Network Group — admin only */}
              {hasRole(employee?.role, networkGroup.minRole) && (
                <div>
                  <button
                    onClick={() => setNetworkOpen(!networkOpen)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                      networkGroup.items.some((i) => location.pathname === i.path)
                        ? 'text-white/80'
                        : 'text-white/50 hover:text-white hover:bg-bo-sidebar-hover'
                    }`}
                  >
                    <Network size={18} strokeWidth={1.5} />
                    <span className="flex-1 text-left">{networkGroup.label}</span>
                    {networkOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {networkOpen && (
                    <div className="mt-0.5 space-y-0.5">
                      {networkGroup.items.filter((i) => hasRole(employee?.role, i.minRole)).map((item) => renderNavItem(item, true))}
                    </div>
                  )}
                </div>
              )}

              {/* RH Group — manager+ */}
              {hasRole(employee?.role, rhGroup.minRole) && (
                <div>
                  <button
                    onClick={() => setRhOpen(!rhOpen)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                      rhGroup.items.some((i) => location.pathname === i.path)
                        ? 'text-white/80'
                        : 'text-white/50 hover:text-white hover:bg-bo-sidebar-hover'
                    }`}
                  >
                    <UsersRound size={18} strokeWidth={1.5} />
                    <span className="flex-1 text-left">{rhGroup.label}</span>
                    {rhOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {rhOpen && (
                    <div className="mt-0.5 space-y-0.5">
                      {rhGroup.items.filter((i) => hasRole(employee?.role, i.minRole)).map((item) => renderNavItem(item, true))}
                    </div>
                  )}
                </div>
              )}

              {posNavBottom.filter((i) => hasRole(employee?.role, i.minRole)).map((item) => renderNavItem(item))}
            </>
          ) : (
            /* TimeWin24 nav */
            tw24NavItems.map((item) => renderNavItem(item))
          )}
        </nav>

        {/* Footer */}
        <div className="px-3 pb-5 space-y-2">
          {/* Store Switcher (admin only, multi-store) */}
          <StoreSwitcher />

          <div className="border-t border-white/10 pt-4 px-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <span className="text-white/70 text-xs font-bold">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white/80 text-xs font-semibold truncate">{displayName}</p>
                <p className="text-white/30 text-[10px]">{roleLabel}</p>
              </div>
              <button
                onClick={handleLogout}
                title="Deconnexion"
                className="text-white/30 hover:text-white/70 transition-colors"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
          <p className="text-center text-[10px] text-white/20">
            CAISSE v0.2.0
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 ml-[240px] overflow-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
