import React, { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

/**
 * Route guard for backoffice.
 * Restores session from localStorage on first render.
 * Shows a minimal loading state (not blank) while restoring.
 * Redirects to /login only if restore is done AND not authenticated.
 */
export function ProtectedRoute() {
  const { isAuthenticated, restoreSession } = useAuthStore();
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    try {
      restoreSession();
    } catch (err) {
      console.error('[ProtectedRoute] restoreSession failed:', err);
    }
    setIsRestoring(false);
  }, []);

  // Show a minimal spinner while restoring (prevents page blanche)
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
