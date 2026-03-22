import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { usePOSStore } from '../stores/posStore';

/**
 * Route guard for POS Desktop.
 * - Restores session from localStorage on mount
 * - Polls for token removal (API interceptor soft logout)
 * - Shows spinner while restoring (never blank page)
 */
export function ProtectedRoute() {
  const employee = usePOSStore((s) => s.employee);
  const accessToken = usePOSStore((s) => s.accessToken);
  const setEmployee = usePOSStore((s) => s.setEmployee);
  const logout = usePOSStore((s) => s.logout);
  const [checked, setChecked] = useState(false);

  // Restore session from localStorage on mount
  useEffect(() => {
    if (!employee || !accessToken) {
      const savedToken = localStorage.getItem('accessToken');
      const savedEmp = localStorage.getItem('pos_employee');
      if (savedToken && savedEmp) {
        try {
          setEmployee(JSON.parse(savedEmp), savedToken);
        } catch {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('pos_employee');
        }
      }
    }
    setChecked(true);
  }, []);

  // Poll for token removal by API interceptor (soft logout)
  useEffect(() => {
    if (!employee) return;
    const interval = setInterval(() => {
      const token = localStorage.getItem('accessToken');
      if (!token && employee) {
        logout();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [employee, logout]);

  if (!checked) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#F8F8FA',
      }}>
        <div style={{
          width: '32px', height: '32px',
          border: '3px solid #e2e8f0', borderTopColor: '#6366f1',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!employee || !accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
