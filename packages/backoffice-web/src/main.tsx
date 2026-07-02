import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { StoreSelectPage } from './pages/StoreSelectPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { ReportsPage } from './pages/ReportsPage';
import { AccountingPage } from './pages/AccountingPage';
import { IntegrationSupervisionPage } from './pages/IntegrationSupervisionPage';
import { InventoryVariancePage } from './pages/InventoryVariancePage';
import { SettingsPage } from './pages/SettingsPage';
import { StockAlertsPage } from './pages/StockAlertsPage';
import { StockReconcilePage } from './pages/StockReconcilePage';
import { StockNetworkPage } from './pages/StockNetworkPage';
import { LabelsPage } from './pages/LabelsPage';
import { ProductPerformancePage } from './pages/ProductPerformancePage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { UnitsPage } from './pages/UnitsPage';
import { StoresManagementPage } from './pages/StoresManagementPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { PayrollPage } from './pages/PayrollPage';
import { PlanningPage } from './pages/PlanningPage';
import { ReturnsPage } from './pages/ReturnsPage';
import { ConnectedAppsPage } from './pages/ConnectedAppsPage';
import { AirtableOpsPage } from './pages/AirtableOpsPage';
import { SalesGuardsPage } from './pages/SalesGuardsPage';
import { BillingPage } from './pages/BillingPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { NetworkDashboardPage } from './pages/NetworkDashboardPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/globals.css';

/* ══════════════════════════════════════════════════════════════
   ROUTES — Architecture par couches metier
   ══════════════════════════════════════════════════════════════
   /login            → Public
   /select-store     → Store selector (full screen)
   /                 → Dashboard magasin (scope=store)
   /network          → Dashboard reseau (scope=global)
   /products         → Couche 3: Exploitation
   /stock-alerts     → Couche 3: Exploitation
   /stock-network    → Couche 6: Stock reseau
   /labels           → Couche 3: Exploitation
   /reports          → Couche 5: Analyse
   /organizations    → Couche 2: Structure
   /units            → Couche 2: Structure
   /stores           → Couche 2: Structure
   /connected-apps   → Couche 2: Structure
   /billing          → Couche 7: Reglages
   /settings         → Couche 7: Reglages
   /timewin24        → Couche 4: Equipes
   ══════════════════════════════════════════════════════════════ */

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected */}
        <Route element={<ProtectedRoute />}>
          {/* Full screen (no sidebar) */}
          <Route path="/select-store" element={<StoreSelectPage />} />

          {/* Main app with sidebar — ALL pages inside Layout */}
          <Route element={<Layout />}>
            {/* Couche 1: Pilotage global */}
            <Route path="/network" element={<NetworkDashboardPage />} />

            {/* Couche 3: Exploitation magasin */}
            <Route path="/" element={<DashboardPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/stock-alerts" element={<StockAlertsPage />} />
            <Route path="/stock-reconcile" element={<StockReconcilePage />} />
            <Route path="/labels" element={<LabelsPage />} />
            <Route path="/performance" element={<ProductPerformancePage />} />

            {/* Couche 5: Analyse */}
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/accounting" element={<AccountingPage />} />
            <Route path="/integration" element={<IntegrationSupervisionPage />} />
            <Route path="/inventory-variance" element={<InventoryVariancePage />} />
            <Route path="/sales-guards" element={<SalesGuardsPage />} />
            <Route path="/returns" element={<ReturnsPage />} />

            {/* Couche 6: Stock / Logistique */}
            <Route path="/stock-network" element={<StockNetworkPage />} />

            {/* Couche 2: Structure / Administration */}
            <Route path="/organizations" element={<OrganizationsPage />} />
            <Route path="/units" element={<UnitsPage />} />
            <Route path="/stores" element={<StoresManagementPage />} />
            <Route path="/connected-apps" element={<ConnectedAppsPage />} />
            <Route path="/airtable-ops" element={<AirtableOpsPage />} />

            {/* Couche 4: Equipes / RH */}
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/payroll" element={<PayrollPage />} />
            <Route path="/planning" element={<PlanningPage />} />
            <Route path="/timewin24" element={<ComingSoonPage />} />

            {/* Couche 7: Reglages */}
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/settings" element={<SettingsPage />} />

            {/* Catch-all — redirect to dashboard */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
