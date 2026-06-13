// ── AppShell ─────────────────────────────────────────────────────
// Mobile layout: header + content + bottom navigation (4 tabs)
// ─────────────────────────────────────────────────────────────────

import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ScanBarcode, ClipboardList, PackageCheck, Search, Gauge } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { OfflineIndicator } from './OfflineIndicator';
import { canAccessCockpit } from '../cockpit/access';

const tabs = [
  { path: '/scan', label: 'Scan', icon: ScanBarcode, requiresStock: false, requiresCockpit: false },
  { path: '/inventory', label: 'Inventaire', icon: ClipboardList, requiresStock: true, requiresCockpit: false },
  { path: '/receiving', label: 'Reception', icon: PackageCheck, requiresStock: true, requiresCockpit: false },
  { path: '/search', label: 'Recherche', icon: Search, requiresStock: false, requiresCockpit: false },
  // Cockpit : gate UX (ne pas montrer ce qu'on ne peut pas utiliser) — la
  // garantie est le scope INV-5 côté serveur, jamais ce filtre.
  { path: '/cockpit', label: 'Cockpit', icon: Gauge, requiresStock: false, requiresCockpit: true },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const canModifyStock = useAuthStore((s) => s.canModifyStock);
  const storeInfo = useAuthStore((s) => s.storeInfo);
  const employee = useAuthStore((s) => s.employee);

  const visibleTabs = tabs.filter(
    (t) => (!t.requiresStock || canModifyStock()) && (!t.requiresCockpit || canAccessCockpit(employee?.role)),
  );

  return (
    <div className="flex flex-col min-h-[100dvh] bg-mobile-bg">
      {/* ── Offline/sync status bar ── */}
      <OfflineIndicator />

      {/* ── Content area ── */}
      <main className="flex-1 overflow-y-auto hide-scrollbar">
        <Outlet />
      </main>

      {/* ── Bottom navigation ── */}
      <nav className="bg-white border-t border-mobile-border/60 safe-bottom">
        <div className="flex items-stretch">
          {visibleTabs.map((tab) => {
            const isActive = location.pathname === tab.path;
            const Icon = tab.icon;

            return (
              <button
                key={tab.path}
                onClick={() => navigate(tab.path)}
                className={`flex-1 flex flex-col items-center justify-center py-2.5 transition-colors touch-target ${
                  isActive
                    ? 'text-mobile-accent'
                    : 'text-mobile-muted'
                }`}
              >
                <Icon
                  size={22}
                  strokeWidth={isActive ? 2.5 : 1.8}
                />
                <span className={`text-[10px] mt-0.5 font-semibold ${
                  isActive ? 'text-mobile-accent' : 'text-mobile-muted'
                }`}>
                  {tab.label}
                </span>
                {isActive && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-mobile-accent rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
