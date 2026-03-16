import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Loader2 } from 'lucide-react';

/**
 * Route guard for mobile PWA.
 * Restores session from localStorage on first render (prevents flash of login).
 * Redirects to /login if user is not authenticated.
 */
export function ProtectedRoute() {
  const { isAuthenticated, restoreSession } = useAuthStore();
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    restoreSession();
    setIsRestoring(false);
  }, []);

  if (isRestoring) {
    return (
      <div className="flex items-center justify-center h-dvh bg-gray-50">
        <Loader2 size={28} className="animate-spin text-violet-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
