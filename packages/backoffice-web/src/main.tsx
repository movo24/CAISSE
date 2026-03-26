import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { StoreSelectPage } from './pages/StoreSelectPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
// ── ALL RH PAGES REMOVED — Managed exclusively by TimeWin24 ──
// EmployeesPage, RightsPage, PointagePage, PerformancePage, PlanningPage, PayrollPage
import { StockAlertsPage } from './pages/StockAlertsPage';
import { LabelsPage } from './pages/LabelsPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { UnitsPage } from './pages/UnitsPage';
import { StoresManagementPage } from './pages/StoresManagementPage';
import { ConnectedAppsPage } from './pages/ConnectedAppsPage';
import { BillingPage } from './pages/BillingPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { NetworkDashboardPage } from './pages/NetworkDashboardPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected — require authentication */}
        <Route element={<ProtectedRoute />}>
          {/* Store selector (full screen, no sidebar) */}
          <Route path="/select-store" element={<StoreSelectPage />} />
          <Route path="/network" element={<NetworkDashboardPage />} />

          {/* Main app with sidebar */}
          <Route element={<Layout />}>
            {/* POS Core */}
            <Route path="/" element={<DashboardPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/stock-alerts" element={<StockAlertsPage />} />
            <Route path="/labels" element={<LabelsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {/* Network / Admin */}
            <Route path="/organizations" element={<OrganizationsPage />} />
            <Route path="/units" element={<UnitsPage />} />
            <Route path="/stores" element={<StoresManagementPage />} />
            <Route path="/connected-apps" element={<ConnectedAppsPage />} />
            <Route path="/billing" element={<BillingPage />} />
            {/* TimeWin24 */}
            <Route path="/timewin24" element={<ComingSoonPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
// build: 1774484373
