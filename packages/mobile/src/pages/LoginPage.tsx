// ── Porte d'entrée The Wesley Control ────────────────────────────
// Connexion via le système d'authentification CENTRAL du dashboard
// (POST /api/auth/login/admin : email + code d'accès — même mécanisme
// que le back-office). Aucun code magasin : le profil, le rôle et les
// magasins accessibles sont déterminés côté serveur (JWT + guards).
// Session valide déjà présente → entrée directe (ProtectedRoute).
// Identité : logo officiel The Wesleys (public/brand/, copié depuis
// les assets du site principal) — aucun logo recréé.
// ─────────────────────────────────────────────────────────────────

import { FormEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Fingerprint, Loader2, Lock, Mail } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { detectPasskeySupport, isUserCancellation, loginWithPasskey, PasskeySupport } from '../lib/webauthn';

export function LoginPage() {
  const { isAuthenticated, loginWesley, isLoading, error, applySession } = useAuthStore();
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [passkey, setPasskey] = useState<PasskeySupport | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  useEffect(() => {
    detectPasskeySupport().then(setPasskey).catch(() => setPasskey(null));
  }, []);

  const passkeyLogin = async () => {
    setPasskeyBusy(true);
    setPasskeyError(null);
    try {
      // Cérémonie WebAuthn native (Face ID / Touch ID / Hello / clé FIDO2) —
      // l'app ne s'ouvre qu'après validation SERVEUR de la signature.
      const session = await loginWithPasskey();
      applySession(session);
    } catch (e: any) {
      if (isUserCancellation(e)) {
        setPasskeyError('Connexion annulée.');
      } else {
        setPasskeyError(
          e?.response?.data?.message ??
            'Aucune clé d’accès utilisable sur cet appareil — utilisez la connexion The Wesley.',
        );
      }
    } finally {
      setPasskeyBusy(false);
    }
  };

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const canSubmit = email.includes('@') && pin.length >= 4 && !isLoading;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) await loginWesley(email.trim(), pin);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-mobile-bg px-5 py-8 safe-top safe-bottom">
      <main className="w-full max-w-sm">
        {/* Carte centrale claire et compacte */}
        <div className="bg-white rounded-3xl shadow-card border border-mobile-border/60 px-6 py-8 sm:px-8">
          {/* Logo officiel The Wesleys — net, sans effet */}
          <img
            src="/brand/wesleys-logo-official.png"
            alt="The Wesleys"
            className="mx-auto w-56 max-w-full h-auto select-none"
            draggable={false}
          />

          <h1 className="mt-6 text-center text-[17px] font-bold tracking-[0.18em] text-mobile-text">
            THE WESLEY CONTROL
          </h1>
          <p className="mt-1 text-center text-sm text-mobile-muted">
            Supervision et analyse du réseau
          </p>
          <p className="mt-0.5 text-center text-[11px] text-mobile-muted/80">
            Accès sécurisé en lecture seule
          </p>

          <div className="mt-7 space-y-3">
            {/* Prioritaire : clé d'accès (biométrie gérée par l'OS) */}
            {passkey?.available && !showForm && (
              <>
                <button
                  onClick={passkeyLogin}
                  disabled={passkeyBusy}
                  className="w-full min-h-[48px] rounded-2xl bg-mobile-text text-white text-sm font-bold
                             flex items-center justify-center gap-2 disabled:opacity-60 active:opacity-90
                             focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                             focus-visible:outline-violet-600 transition-opacity"
                >
                  {passkeyBusy ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />}
                  {passkeyBusy ? 'Validation…' : passkey.buttonLabel}
                </button>
                {passkeyError && (
                  <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2.5">
                    {passkeyError}
                  </p>
                )}
              </>
            )}

            {!showForm ? (
              <button
                onClick={() => setShowForm(true)}
                className={`w-full min-h-[48px] rounded-2xl text-sm font-bold active:opacity-90
                           focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                           focus-visible:outline-violet-600 transition-opacity ${
                             passkey?.available
                               ? 'bg-mobile-subtle text-mobile-text'
                               : 'bg-mobile-text text-white'
                           }`}
              >
                Se connecter avec The Wesley
              </button>
            ) : (
              <form onSubmit={submit} className="space-y-3 animate-fade-in" noValidate>
                <label className="block">
                  <span className="text-[11px] font-semibold text-mobile-muted">Email professionnel</span>
                  <span className="relative block mt-1">
                    <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mobile-muted" />
                    <input
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="prenom@thewesleys.fr"
                      autoFocus
                      className="w-full min-h-[48px] pl-10 pr-4 rounded-2xl border border-mobile-border bg-mobile-subtle/60
                                 text-sm text-mobile-text placeholder-mobile-muted/60
                                 focus:outline-none focus:ring-2 focus:ring-violet-600/50 focus:border-violet-600/40"
                    />
                  </span>
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-mobile-muted">Code d'accès</span>
                  <span className="relative block mt-1">
                    <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mobile-muted" />
                    <input
                      type="password"
                      autoComplete="current-password"
                      inputMode="numeric"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="••••"
                      className="w-full min-h-[48px] pl-10 pr-4 rounded-2xl border border-mobile-border bg-mobile-subtle/60
                                 text-sm text-mobile-text placeholder-mobile-muted/60 tracking-widest
                                 focus:outline-none focus:ring-2 focus:ring-violet-600/50 focus:border-violet-600/40"
                    />
                  </span>
                </label>

                {error && (
                  <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2.5">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full min-h-[48px] rounded-2xl bg-mobile-text text-white text-sm font-bold
                             disabled:opacity-40 active:opacity-90 flex items-center justify-center gap-2
                             focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                             focus-visible:outline-violet-600 transition-opacity"
                >
                  {isLoading && <Loader2 size={16} className="animate-spin" />}
                  {isLoading ? 'Connexion…' : 'Connexion'}
                </button>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-[11px] text-mobile-muted/80">
            Accès réservé aux équipes autorisées
          </p>
        </div>
      </main>
    </div>
  );
}
