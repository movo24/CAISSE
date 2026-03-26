import React, { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

/**
 * Route guard for backoffice.
 * - Restores session from localStorage on first render
 * - Watches for token removal (API interceptor logout)
 * - Shows spinner while restoring (never blank page)
 * - Redirects to /login via React router (never window.location.href)
 */
export function ProtectedRoute() {
  const { isAuthenticated, restoreSession } = useAuthStore();
  const [isRestoring, setIsRestoring] = useState(true);

  // Restore session on mount — nuclear safety: if ANYTHING crashes, wipe storage
  useEffect(() => {
    try {
      restoreSession();
    } catch (err) {
      console.error('[ProtectedRoute] restoreSession CRASHED — wiping corrupt storage:', err);
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('employee');
      localStorage.removeItem('currentStoreId');
      localStorage.removeItem('currentApp');
      useAuthStore.setState({
        isAuthenticated: false, employee: null, accessToken: null,
        currentStoreId: null, stores: [], error: null,
      });
    }
    setIsRestoring(false);
  }, []);

  // Watch for token removal by API interceptors (soft logout)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'accessToken' && e.newValue === null) {
        // Token was removed → force unauthenticated state
        useAuthStore.setState({
          isAuthenticated: false,
          employee: null,
          accessToken: null,
        });
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Also poll localStorage periodically (storage event doesn't fire in same tab)
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      const token = localStorage.getItem('accessToken');
      if (!token && isAuthenticated) {
        useAuthStore.setState({
          isAuthenticated: false,
          employee: null,
          accessToken: null,
        });
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  if (isRestoring) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F8F8FA',
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid #e2e8f0',
          borderTopColor: '#6366f1',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
