import { useEffect, useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { getAccessToken } from '../services/api';

export function AuthGate() {
  const [state, setState] = useState<'loading' | 'authed' | 'guest'>('loading');

  useEffect(() => {
    getAccessToken().then((token) => {
      setState(token ? 'authed' : 'guest');
    });
  }, []);

  if (state === 'loading') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <div className="gradient-text" style={{ fontSize: 22 }}>
          The Wesley Club
        </div>
      </div>
    );
  }

  if (state === 'guest') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
