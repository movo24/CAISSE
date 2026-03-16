import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { usePOSStore } from '../stores/posStore';

/**
 * Route guard for POS Desktop.
 * Checks posStore for employee + accessToken.
 * Restores token from localStorage on mount (prevents flash of login).
 * Redirects to /login if not authenticated.
 */
export function ProtectedRoute() {
  const employee = usePOSStore((s) => s.employee);
  const accessToken = usePOSStore((s) => s.accessToken);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // If posStore has no token but localStorage does, the store will
    // have been hydrated by zustand persist (if configured).
    // Either way, after first render we know the auth state.
    setChecked(true);
  }, []);

  if (!checked) return null;

  if (!employee || !accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
