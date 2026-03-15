import React, { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

/**
 * Route guard for backoffice.
 * Redirects to /login if user is not authenticated.
 * Restores session from localStorage on first render with JWT expiry validation.
 */
export function ProtectedRoute() {
  const { isAuthenticated, restoreSession } = useAuthStore();
  const [isRestoring, setIsRestoring] = useState(true);

  // Try to restore session from localStorage on mount
  useEffect(() => {
    restoreSession();
    setIsRestoring(false);
  }, []);

  // Show nothing while restoring session (prevents flash of login page)
  if (isRestoring) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
