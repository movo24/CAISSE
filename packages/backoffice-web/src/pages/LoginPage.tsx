import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error } = useAuthStore();
  const [storeId, setStoreId] = useState('');
  const [pin, setPin] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId.trim() || !pin.trim()) return;
    await login(storeId.trim(), pin.trim());
    // If login succeeded, authStore.isAuthenticated will be true
    const token = localStorage.getItem('accessToken');
    if (token) {
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-white/10 border border-white/20 items-center justify-center mb-4">
            <span className="text-3xl font-black text-white">C</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">CAISSE Backoffice</h1>
          <p className="text-sm text-white/50 mt-1">Connectez-vous pour acceder au tableau de bord</p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-8 space-y-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
              Identifiant Magasin (Store ID)
            </label>
            <input
              type="text"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/15 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all text-sm"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
              Code PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/15 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all text-sm text-center text-2xl tracking-[0.5em]"
              placeholder="****"
              maxLength={8}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || !storeId.trim() || !pin.trim()}
            className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition-all shadow-lg shadow-blue-600/25"
          >
            {isLoading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <p className="text-center text-xs text-white/30 mt-6">
          Acces reserve au personnel autorise
        </p>
      </div>
    </div>
  );
}
