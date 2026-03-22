// ── LoginPage ────────────────────────────────────────────────────
// PIN login with numeric keypad, storeId remembered
// ─────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { ScanBarcode, Store, Loader2, Delete } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

export function LoginPage() {
  const { isAuthenticated, login, isLoading, error } = useAuthStore();
  const [storeId, setStoreId] = useState(() => localStorage.getItem('lastStoreId') || '');
  const [pin, setPin] = useState('');
  const [showStoreInput, setShowStoreInput] = useState(() => !localStorage.getItem('lastStoreId'));

  const handlePinDigit = useCallback((digit: string) => {
    // Clear error on new input
    if (useAuthStore.getState().error) {
      useAuthStore.setState({ error: null });
    }
    setPin((prev) => {
      if (prev.length >= 8) return prev;
      return prev + digit;
    });
  }, []);

  const handleDelete = useCallback(() => {
    if (useAuthStore.getState().error) {
      useAuthStore.setState({ error: null });
    }
    setPin((prev) => prev.slice(0, -1));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (pin.length >= 4 && storeId) {
      await login(storeId, pin);
      // Reset PIN after failed attempt
      if (!useAuthStore.getState().isAuthenticated) {
        setTimeout(() => setPin(''), 1500);
      }
    }
  }, [pin, storeId, login]);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-gradient-to-b from-violet-600 to-violet-800 px-6 safe-top safe-bottom">
      {/* ── Logo ── */}
      <div className="mb-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center mx-auto mb-4">
          <ScanBarcode size={32} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-white">CAISSE Inventaire</h1>
        <p className="text-violet-200 text-sm mt-1">Scanner & gestion de stock</p>
      </div>

      {/* ── Store ID input ── */}
      {showStoreInput ? (
        <div className="w-full max-w-xs mb-6 animate-fade-in">
          <label className="text-violet-200 text-xs font-semibold mb-2 block">
            Code magasin
          </label>
          <div className="relative">
            <Store size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-violet-300" />
            <input
              type="text"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value.trim())}
              placeholder="ex: BELLERIVE"
              className="w-full pl-10 pr-4 py-3.5 rounded-2xl bg-white/10 border border-white/20 text-white placeholder-violet-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-white/40"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && storeId) setShowStoreInput(false);
              }}
            />
          </div>
          <button
            onClick={() => storeId && setShowStoreInput(false)}
            disabled={!storeId}
            className="w-full mt-3 py-3 rounded-2xl bg-white text-violet-700 font-bold text-sm disabled:opacity-40 transition-opacity"
          >
            Continuer
          </button>
        </div>
      ) : (
        <div className="w-full max-w-xs animate-fade-in">
          {/* Store badge */}
          <button
            onClick={() => setShowStoreInput(true)}
            className="flex items-center gap-2 mx-auto mb-6 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-violet-100 text-xs font-semibold"
          >
            <Store size={13} />
            {storeId}
          </button>

          {/* PIN dots (supports 4-8 digit PINs) */}
          <div className="flex items-center justify-center gap-2.5 mb-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full transition-all duration-200 ${
                  pin.length > i
                    ? 'bg-white scale-110'
                    : 'bg-white/20 border border-white/30'
                }`}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 px-4 py-2.5 rounded-xl bg-red-500/20 border border-red-400/30 text-red-100 text-xs font-medium text-center">
              {error}
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex items-center justify-center mb-4">
              <Loader2 size={24} className="text-white animate-spin" />
            </div>
          )}

          {/* Numeric keypad */}
          {!isLoading && (
            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((key) => {
                if (key === '') return <div key="empty" />;
                if (key === 'del') {
                  return (
                    <button
                      key="del"
                      onClick={handleDelete}
                      className="h-16 rounded-2xl bg-white/10 flex items-center justify-center text-white keypad-btn active:bg-white/20 transition-colors"
                    >
                      <Delete size={22} />
                    </button>
                  );
                }
                return (
                  <button
                    key={key}
                    onClick={() => handlePinDigit(key)}
                    className="h-16 rounded-2xl bg-white/10 flex items-center justify-center text-white text-2xl font-semibold keypad-btn active:bg-white/20 transition-colors"
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          )}

          {/* Manual submit (for 5-6 digit PINs) */}
          {pin.length >= 4 && !isLoading && (
            <button
              onClick={handleSubmit}
              className="w-full mt-4 py-3.5 rounded-2xl bg-white text-violet-700 font-bold text-sm transition-opacity"
            >
              Se connecter
            </button>
          )}
        </div>
      )}
    </div>
  );
}
