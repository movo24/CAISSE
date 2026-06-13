import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { ScanPage } from './pages/ScanPage';
import { InventoryPage } from './pages/InventoryPage';
import { ReceivingPage } from './pages/ReceivingPage';
import { SearchPage } from './pages/SearchPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/globals.css';

// Cockpit (étage 5) — module de route LAZY à frontière propre : l'employé
// inventaire ne télécharge jamais ce chunk. Le role-gate (onglet AppShell) est
// de l'UX ; la garantie est le scope INV-5 côté serveur.
const CockpitPage = React.lazy(() => import('./cockpit'));

function App() {
  const restoreSession = useAuthStore((s) => s.restoreSession);

  useEffect(() => {
    restoreSession();
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, [restoreSession]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/receiving" element={<ReceivingPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route
              path="/cockpit"
              element={
                <React.Suspense fallback={<p className="p-4 text-sm">Chargement du cockpit…</p>}>
                  <CockpitPage />
                </React.Suspense>
              }
            />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
