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
import { AssistantPage } from './pages/AssistantPage';
import { LivePerformancePage } from './pages/LivePerformancePage';
import { StockAlertsPage } from './pages/StockAlertsPage';
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
            <Route path="/live-performance" element={<LivePerformancePage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/stock-alerts" element={<StockAlertsPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/rights" element={<RightsPage />} />
            <Route path="/pointage" element={<PointagePage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/planning" element={<PlanningPage />} />
            <Route path="/payroll" element={<PayrollPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
