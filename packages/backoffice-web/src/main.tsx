import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { StoreSelectPage } from './pages/StoreSelectPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductEditPage } from './pages/ProductEditPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ReceiptSettingsPage } from './pages/ReceiptSettingsPage';
import { StockAlertsPage } from './pages/StockAlertsPage';
import { StockNetworkPage } from './pages/StockNetworkPage';
import { LabelsPage } from './pages/LabelsPage';
import { ProductPerformancePage } from './pages/ProductPerformancePage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { UnitsPage } from './pages/UnitsPage';
import { StoresManagementPage } from './pages/StoresManagementPage';
import { PosEnrollmentPage } from './pages/PosEnrollmentPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { PayrollPage } from './pages/PayrollPage';
import { PlanningPage } from './pages/PlanningPage';
import { ReturnsPage } from './pages/ReturnsPage';
import { ConnectedAppsPage } from './pages/ConnectedAppsPage';
import { AirtableOpsPage } from './pages/AirtableOpsPage';
import { SecurityAccessPage } from './pages/SecurityAccessPage';
import { SalesGuardsPage } from './pages/SalesGuardsPage';
import { BillingPage } from './pages/BillingPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { NetworkDashboardPage } from './pages/NetworkDashboardPage';
import { ProductVariantsPage } from './pages/ProductVariantsPage';
import { StorePricesPage } from './pages/StorePricesPage';
import { BrandsSuppliersPage } from './pages/BrandsSuppliersPage';
import { CategoriesAdminPage } from './pages/CategoriesAdminPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { PromoCodesPage } from './pages/PromoCodesPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { PendingPaymentsPage } from './pages/PendingPaymentsPage';
import { InventoryVariancePage } from './pages/InventoryVariancePage';
import { CashSessionsPage } from './pages/CashSessionsPage';
import { SalesPage } from './pages/SalesPage';
import { EmployeeScoresPage } from './pages/EmployeeScoresPage';
import ProductIntegrationPage from './pages/ProductIntegrationPage';
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
            <Route path="/products/new" element={<ProductEditPage />} />
            <Route path="/products/:id/edit" element={<ProductEditPage />} />
            <Route path="/products/:id" element={<ProductDetailPage />} />
            <Route path="/catalog/variants" element={<ProductVariantsPage />} />
            <Route path="/catalog/store-prices" element={<StorePricesPage />} />
            <Route path="/catalog/brands-suppliers" element={<BrandsSuppliersPage />} />
            <Route path="/catalog/categories" element={<CategoriesAdminPage />} />
            <Route path="/promo-codes" element={<PromoCodesPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/pending-payments" element={<PendingPaymentsPage />} />
            <Route path="/inventory-variance" element={<InventoryVariancePage />} />
            <Route path="/product-integration" element={<ProductIntegrationPage />} />
            <Route path="/stock-alerts" element={<StockAlertsPage />} />
            <Route path="/labels" element={<LabelsPage />} />
            <Route path="/performance" element={<ProductPerformancePage />} />

            {/* Couche 5: Analyse */}
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/cash-sessions" element={<CashSessionsPage />} />
            <Route path="/employee-scores" element={<EmployeeScoresPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/sales-guards" element={<SalesGuardsPage />} />
            <Route path="/returns" element={<ReturnsPage />} />

            {/* Couche 6: Stock / Logistique */}
            <Route path="/stock-network" element={<StockNetworkPage />} />

            {/* Couche 2: Structure / Administration */}
            <Route path="/organizations" element={<OrganizationsPage />} />
            <Route path="/units" element={<UnitsPage />} />
            <Route path="/stores" element={<StoresManagementPage />} />
            <Route path="/stores/receipt-settings" element={<ReceiptSettingsPage />} />
            <Route path="/pos-enrollment" element={<PosEnrollmentPage />} />
            <Route path="/connected-apps" element={<ConnectedAppsPage />} />
            <Route path="/airtable-ops" element={<AirtableOpsPage />} />
            <Route path="/security" element={<SecurityAccessPage />} />

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
