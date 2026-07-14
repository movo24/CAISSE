// ── AppShell — centre de pilotage réseau (LECTURE SEULE) ─────────
// Navigation basse 5 onglets : Vue d'ensemble, Points de vente,
// Produits, Comparer, Analyses. Les Alertes sont accessibles depuis
// la cloche de la Vue d'ensemble (+ route directe /alerts).
// Accès réservé manager/admin — un profil caissier voit un écran
// d'information, pas de données réseau.
// ─────────────────────────────────────────────────────────────────

import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Store, Package, GitCompareArrows, ChartColumn, LogOut } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { PasskeyPrompt } from './PasskeyPrompt';

const tabs = [
  { path: '/', label: 'Vue d’ensemble', icon: LayoutDashboard },
  { path: '/stores', label: 'Points de vente', icon: Store },
  { path: '/products', label: 'Produits', icon: Package },
  { path: '/compare', label: 'Comparer', icon: GitCompareArrows },
  { path: '/analytics', label: 'Analyses', icon: ChartColumn },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const employee = useAuthStore((s) => s.employee);
  const logout = useAuthStore((s) => s.logout);

  const isSupervisor = employee?.role === 'manager' || employee?.role === 'admin';

  if (!isSupervisor) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-mobile-bg px-8 text-center gap-4">
        <img src="/icons/app-icon.png" alt="Logo" className="h-14 w-14 rounded-2xl" />
        <h1 className="text-lg font-bold text-mobile-text">Accès réservé</h1>
        <p className="text-sm text-mobile-muted">
          The Wesley Control est réservé aux profils manager et admin.
          Votre profil ({employee?.role ?? 'inconnu'}) ne permet pas de consulter
          les données du réseau.
        </p>
        <button
          onClick={() => {
            logout();
            navigate('/login');
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-mobile-accent text-white text-sm font-bold"
        >
          <LogOut size={15} /> Changer de compte
        </button>
      </div>
    );
  }

  const activePath = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div className="flex flex-col min-h-[100dvh] bg-mobile-bg">
      <main className="flex-1 overflow-y-auto hide-scrollbar">
        <Outlet />
      </main>

      {/* Proposition d'activation passkey (une fois, explicite) */}
      <PasskeyPrompt />

      <nav className="bg-white border-t border-mobile-border/60 safe-bottom">
        <div className="flex items-stretch">
          {tabs.map((tab) => {
            const isActive = activePath(tab.path);
            const Icon = tab.icon;
            return (
              <button
                key={tab.path}
                onClick={() => navigate(tab.path)}
                className={`relative flex-1 flex flex-col items-center justify-center py-2.5 transition-colors touch-target ${
                  isActive ? 'text-mobile-accent' : 'text-mobile-muted'
                }`}
              >
                <Icon size={21} strokeWidth={isActive ? 2.5 : 1.8} />
                <span className={`text-[9px] mt-0.5 font-semibold ${isActive ? 'text-mobile-accent' : 'text-mobile-muted'}`}>
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
