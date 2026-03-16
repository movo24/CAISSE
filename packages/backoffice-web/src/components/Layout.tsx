import React, { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, FileBarChart, Settings, LogOut, Users,
  ChevronDown, ChevronRight, ShieldCheck, UsersRound, Clock, BarChart3, Calendar, Wallet,
  Sparkles, Activity, AlertTriangle, Building2, Store, Network, Plug,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
}

interface NavGroup {
  label: string;
  icon: React.ElementType;
  items: NavItem[];
}

const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/live-performance', label: 'Perf. Réseau', icon: Activity },
  { path: '/products', label: 'Produits', icon: Package },
  { path: '/stock-alerts', label: 'Alertes Stock', icon: AlertTriangle },
  { path: '/employees', label: 'Employes', icon: Users },
];

const networkGroup: NavGroup = {
  label: 'Réseau',
  icon: Network,
  items: [
    { path: '/organizations', label: 'Organisations', icon: Building2 },
    { path: '/units', label: 'Unités', icon: Building2 },
    { path: '/stores', label: 'Magasins', icon: Store },
    { path: '/connected-apps', label: 'Applications', icon: Plug },
  ],
};

const rhGroup: NavGroup = {
  label: 'RH / Equipe',
  icon: UsersRound,
  items: [
    { path: '/rights', label: 'Droits', icon: ShieldCheck },
    { path: '/pointage', label: 'Pointage', icon: Clock },
    { path: '/performance', label: 'Performance', icon: BarChart3 },
    { path: '/planning', label: 'Planning', icon: Calendar },
    { path: '/payroll', label: 'Paie', icon: Wallet },
  ],
};

const navItemsBottom: NavItem[] = [
  { path: '/reports', label: 'Rapports', icon: FileBarChart },
  { path: '/assistant', label: 'Assistant IA', icon: Sparkles },
  { path: '/settings', label: 'Reglages', icon: Settings },
];

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { employee, logout } = useAuthStore();
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

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-[240px] bg-bo-sidebar flex flex-col fixed inset-y-0 left-0 z-20">
        {/* Logo */}
        <div className="px-5 py-6 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-bo-accent flex items-center justify-center">
            <span className="text-white text-sm font-black">C</span>
          </div>
          <div>
            <h1 className="text-white text-sm font-bold tracking-wide">CAISSE</h1>
            <p className="text-white/30 text-[10px] font-medium">Back-Office</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-1 mt-2">
          {navItems.map((item) => renderNavItem(item))}

          {/* Network Group (collapsible) */}
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
                {networkGroup.items.map((item) => renderNavItem(item, true))}
              </div>
            )}
          </div>

          {/* RH Group (collapsible) */}
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
                {rhGroup.items.map((item) => renderNavItem(item, true))}
              </div>
            )}
          </div>

          {navItemsBottom.map((item) => renderNavItem(item))}
        </nav>

        {/* Footer */}
        <div className="px-3 pb-5 space-y-2">
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
            CAISSE v0.1.0
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
