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
import { EmployeesPage } from './pages/EmployeesPage';
import { RightsPage } from './pages/RightsPage';
import { PointagePage } from './pages/PointagePage';
import { PerformancePage } from './pages/PerformancePage';
import { PlanningPage } from './pages/PlanningPage';
import { PayrollPage } from './pages/PayrollPage';
import { StockAlertsPage } from './pages/StockAlertsPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { UnitsPage } from './pages/UnitsPage';
import { StoresManagementPage } from './pages/StoresManagementPage';
import { ConnectedAppsPage } from './pages/ConnectedAppsPage';
import { BillingPage } from './pages/BillingPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected — require authentication */}
        <Route element={<ProtectedRoute />}>
          {/* Store selector (full screen, no sidebar) */}
          <Route path="/select-store" element={<StoreSelectPage />} />

          {/* Main app with sidebar */}
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/stock-alerts" element={<StockAlertsPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/rights" element={<RightsPage />} />
            <Route path="/pointage" element={<PointagePage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/planning" element={<PlanningPage />} />
            <Route path="/payroll" element={<PayrollPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
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
  </React.StrictMode>,
);
