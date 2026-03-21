import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { usePOSStore } from '../stores/posStore';

/**
 * Route guard for POS Desktop.
 * Restores session from localStorage on mount (prevents flash of login).
 * Redirects to /login if not authenticated.
 */
export function ProtectedRoute() {
  const employee = usePOSStore((s) => s.employee);
  const accessToken = usePOSStore((s) => s.accessToken);
  const setEmployee = usePOSStore((s) => s.setEmployee);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Restore session from localStorage if store is empty
    if (!employee || !accessToken) {
      const savedToken = localStorage.getItem('accessToken');
      const savedEmp = localStorage.getItem('pos_employee');
      if (savedToken && savedEmp) {
        try {
          const emp = JSON.parse(savedEmp);
          setEmployee(emp, savedToken);
        } catch {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('pos_employee');
        }
      }
    }
    setChecked(true);
  }, []);

  if (!checked) return null;

  if (!employee || !accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
