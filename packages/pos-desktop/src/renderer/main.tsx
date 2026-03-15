import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { POSPage } from './pages/POSPage';
import { ClientDisplayPage } from './pages/ClientDisplayPage';
import { LoginPage } from './pages/LoginPage';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/pos" element={<POSPage />} />
        <Route path="/client-display" element={<ClientDisplayPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
