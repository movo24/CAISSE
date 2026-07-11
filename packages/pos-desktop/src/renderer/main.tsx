import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { POSPage } from './pages/POSPage';
import { ClientDisplayPage } from './pages/ClientDisplayPage';
import { CustomerDisplaySettingsPage } from './pages/CustomerDisplaySettingsPage';
import { LoginPage } from './pages/LoginPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { EnrollmentGate } from './components/EnrollmentGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { resolveMachineId } from './services/machineIdentity';
import './styles/globals.css';

// Résout (et met en cache) l'identité machine dès le démarrage, avant toute
// vente — l'en-tête X-Machine-Id doit être disponible de façon synchrone.
void resolveMachineId();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/login" element={<LoginPage />} />
        {/* Protected — requires employee + accessToken */}
        <Route element={<ProtectedRoute />}>
          {/* La vente passe par la barrière d'enrôlement (écran d'attente tant
              que la caisse n'est pas validée, si le magasin l'exige). */}
          <Route element={<EnrollmentGate />}>
            <Route path="/pos" element={<POSPage />} />
          </Route>
          <Route path="/display-settings" element={<CustomerDisplaySettingsPage />} />
        </Route>
        {/* Client display is public (customer-facing screen) */}
        <Route path="/client-display" element={<ClientDisplayPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
