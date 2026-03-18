import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
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
// AI pages migrated to TimeWin24
// import { AssistantPage } from './pages/AssistantPage';
// import { LivePerformancePage } from './pages/LivePerformancePage';
import { StockAlertsPage } from './pages/StockAlertsPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { UnitsPage } from './pages/UnitsPage';
import { StoresManagementPage } from './pages/StoresManagementPage';
import { ConnectedAppsPage } from './pages/ConnectedAppsPage';
import { BillingPage } from './pages/BillingPage';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Public route */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected routes — require authentication */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            {/* live-performance → migrated to TimeWin24 */}
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/stock-alerts" element={<StockAlertsPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/rights" element={<RightsPage />} />
            <Route path="/pointage" element={<PointagePage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/planning" element={<PlanningPage />} />
            <Route path="/payroll" element={<PayrollPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            {/* assistant → migrated to TimeWin24 */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/organizations" element={<OrganizationsPage />} />
            <Route path="/units" element={<UnitsPage />} />
            <Route path="/stores" element={<StoresManagementPage />} />
            <Route path="/connected-apps" element={<ConnectedAppsPage />} />
            <Route path="/billing" element={<BillingPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
