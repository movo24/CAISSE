import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { ShieldCheck, Store } from 'lucide-react';

type LoginMode = 'admin' | 'store';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, loginAdmin, isLoading, error } = useAuthStore();
  const [mode, setMode] = useState<LoginMode>(
    () => (localStorage.getItem('caisse_login_mode') as LoginMode) || 'admin',
  );
  const [email, setEmail] = useState(
    () => localStorage.getItem('caisse_login_email') || '',
  );
  const [storeId, setStoreId] = useState(
    () => localStorage.getItem('caisse_login_storeId') || '',
  );
  const [pin, setPin] = useState('');

  const canSubmit =
    mode === 'admin'
      ? !isLoading && email.trim() && pin.trim()
      : !isLoading && storeId.trim() && pin.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    if (mode === 'admin') {
      await loginAdmin(email.trim(), pin.trim());
    } else {
      await login(storeId.trim(), pin.trim());
    }

    const state = useAuthStore.getState();
    if (state.isAuthenticated) {
      // Persist email/storeId only after successful login (not on every keystroke)
      if (mode === 'admin') localStorage.setItem('caisse_login_email', email.trim());
      else localStorage.setItem('caisse_login_storeId', storeId.trim());
      if (state.employee?.role === 'admin') {
        navigate('/select-store', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
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
          <h1 className="text-2xl font-black text-white tracking-tight">CAISSE</h1>
          <p className="text-sm text-white/50 mt-1">Connectez-vous pour accéder au système</p>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-6 bg-white/5 rounded-xl p-1">
          <button
            type="button"
            onClick={() => { setMode('admin'); setPin(''); localStorage.setItem('caisse_login_mode', 'admin'); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${
              mode === 'admin'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <ShieldCheck size={14} />
            Admin
          </button>
          <button
            type="button"
            onClick={() => { setMode('store'); setPin(''); localStorage.setItem('caisse_login_mode', 'store'); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${
              mode === 'store'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <Store size={14} />
            Employé
          </button>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-8 space-y-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300">
              {typeof error === 'string' ? error : 'Erreur de connexion'}
            </div>
          )}

          {mode === 'admin' ? (
            <div>
              <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
                Email administrateur
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/15 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all text-sm"
                placeholder="contact@votreentreprise.com"
                autoFocus
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
                Identifiant Magasin (Store ID)
              </label>
              <input
                type="text"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/15 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all text-sm"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                autoFocus
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
              Code PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/15 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all text-sm text-center text-2xl tracking-[0.5em]"
              placeholder="******"
              maxLength={8}
            />
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition-all shadow-lg shadow-indigo-600/25"
          >
            {isLoading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <p className="text-center text-xs text-white/30 mt-6">
          {mode === 'admin'
            ? 'Accès administrateur — tous les magasins et applications'
            : 'Accès employé — magasin assigné uniquement'}
        </p>
      </div>
    </div>
  );
}
