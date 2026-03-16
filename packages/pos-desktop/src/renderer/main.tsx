import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { POSPage } from './pages/POSPage';
import { ClientDisplayPage } from './pages/ClientDisplayPage';
import { LoginPage } from './pages/LoginPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/login" element={<LoginPage />} />
        {/* Protected — requires employee + accessToken */}
        <Route element={<ProtectedRoute />}>
          <Route path="/pos" element={<POSPage />} />
        </Route>
        {/* Client display is public (customer-facing screen) */}
        <Route path="/client-display" element={<ClientDisplayPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
