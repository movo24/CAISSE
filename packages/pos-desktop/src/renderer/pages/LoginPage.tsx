import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, QrCode, Store, ArrowRight, Monitor, Tablet, Smartphone } from 'lucide-react';
import { authApi, storesApi } from '../services/api';
import { API_URL } from '../utils/apiConfig';
import { usePOSStore } from '../stores/posStore';
import { useRightsStore } from '../stores/rightsStore';
import { usePointageStore } from '../stores/pointageStore';
import { usePerformanceStore } from '../stores/performanceStore';
import { useDeviceProfile, platformClasses } from '../hooks/useDeviceProfile';

export function LoginPage() {
  const navigate = useNavigate();
  const { setEmployee, setStoreInfo } = usePOSStore();
  const rightsStore = useRightsStore();
  const pointageStore = usePointageStore();
  const perfStore = usePerformanceStore();
  const device = useDeviceProfile();
  const [storeId, setStoreId] = useState(() => localStorage.getItem('pos_storeId') || '');
  const [pin, setPin] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [mode, setMode] = useState<'pin' | 'qr'>('pin');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Diagnostic terrain (bug login v1.0.3 → v1.0.4). Affiche, SUR l'écran de
  // login du .exe installé et sans jamais exposer de secret (ni token, ni PIN) :
  //  - la VERSION réellement exécutée (piège « ancienne version encore lancée ») ;
  //  - l'URL backend réellement utilisée par le build ;
  //  - le healthcheck vu par le RENDERER (fetch, soumis au CORS) ;
  //  - le healthcheck vu par le MAIN (net.request, SANS CORS) → joignabilité pure
  //    + code d'erreur Chromium exact (ERR_NAME_NOT_RESOLVED, timeout…) ;
  //  - le détail exact de la dernière tentative de login (endpoint, HTTP, code).
  // Comparer renderer(CORS) vs main(sans CORS) distingue réseau ↔ CORS.
  const posVersion =
    typeof window !== 'undefined' ? (window as any).posDesktop?.version : undefined;
  const [diag, setDiag] = useState<{
    rendererHealth?: string;
    mainHealth?: string;
    login?: string;
  }>({});
  const [probing, setProbing] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    pinRef.current?.focus();
  }, [mode]);

  // Sonde de connectivité complète. Renderer = fetch (subit le CORS, comme le
  // login réel). Main = net.request via IPC (pas de CORS) → dit si le backend
  // est JOIGNABLE tout court, avec le code réseau exact.
  const runDiagnostics = async () => {
    setProbing(true);
    setDiag((d) => ({ ...d, rendererHealth: '…', mainHealth: '…' }));
    // 1) Renderer fetch (avec CORS)
    const t0 = Date.now();
    fetch(`${API_URL}/api/health`, { method: 'GET', cache: 'no-store' })
      .then((res) => setDiag((d) => ({ ...d, rendererHealth: `HTTP ${res.status} · ${Date.now() - t0} ms` })))
      .catch((e: any) => setDiag((d) => ({ ...d, rendererHealth: `ÉCHEC · ${e?.name || 'Error'}: ${e?.message || e}` })));
    // 2) Main net.request (sans CORS) — joignabilité réelle + code exact
    try {
      const probe = (window as any).posDesktop?.diagProbe;
      if (typeof probe === 'function') {
        const r = await probe(`${API_URL}/api/health`);
        setDiag((d) => ({
          ...d,
          mainHealth: r?.ok ? `HTTP ${r.status} · ${r.ms} ms (sans CORS)` : `INJOIGNABLE · ${r?.errorCode} · ${r?.ms} ms`,
        }));
      } else {
        setDiag((d) => ({ ...d, mainHealth: 'indisponible (hors .exe)' }));
      }
    } catch (e: any) {
      setDiag((d) => ({ ...d, mainHealth: `erreur IPC: ${e?.message || e}` }));
    } finally {
      setProbing(false);
    }
  };

  // Auto-run au montage : le diagnostic doit être visible SANS action.
  useEffect(() => {
    runDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      let res;
      if (mode === 'pin') {
        res = await authApi.loginPin(storeId, pin);
      } else {
        res = await authApi.loginQr(qrCode, pin);
      }
      setEmployee(res.data.employee, res.data.accessToken);
      // Remember store ID for next login (no need to re-enter)
      if (storeId) localStorage.setItem('pos_storeId', storeId);
      // Store refresh token for session persistence
      if (res.data.refreshToken) {
        localStorage.setItem('refreshToken', res.data.refreshToken);
      }
      // Store info from backend login response (or fallback fetch)
      if (res.data.storeInfo) {
        setStoreInfo(res.data.storeInfo);
      } else {
        try {
          const storeRes = await storesApi.getMyInfo();
          if (storeRes.data) setStoreInfo(storeRes.data);
        } catch {
          console.warn('[LOGIN] Could not fetch store info');
        }
      }
      // Set employee rights from TimeWin24 permissions (or fallback to role defaults)
      if (res.data.permissions) {
        rightsStore.setRights({
          employeeId: res.data.employee.id,
          role: res.data.employee.role,
          maxDiscountPercent: res.data.permissions.discount_max || res.data.employee.maxDiscountPercent || 5,
          canVoidSale: res.data.permissions.void_sale || false,
          canRefund: res.data.permissions.refund || false,
          canAccessReports: res.data.permissions.view_reports || false,
          canManageStock: res.data.permissions.manage_stock || false,
          canDeleteTicket: false,
          canApplyManualDiscount: res.data.permissions.discount_max > 0,
          canOpenDrawer: res.data.permissions.open_register || true,
          canReprintTicket: true,
          isOverride: false,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const cached = rightsStore.loadFromCache();
        if (!cached) rightsStore.setRightsForRole(res.data.employee.id, res.data.employee.role);
      }
      // Auto clock-in (local UI only — TimeWin24 handles actual clock-in via auth flow)
      const emp = res.data.employee;
      const fullName = `${emp.firstName} ${emp.lastName}`;
      pointageStore.clockIn(emp.id, fullName, emp.storeId);
      // Init performance session
      perfStore.loadPersistedData();
      if (!perfStore.session || perfStore.session.employeeId !== emp.id) {
        perfStore.initSession(emp.id, fullName, emp.storeId);
      }
      navigate('/pos');
    } catch (err: any) {
      const status: number | undefined = err.response?.status;
      const code: string | undefined = err.code; // ERR_NETWORK, ECONNABORTED…
      const backendMsg: string | undefined = err.response?.data?.message;
      setError(backendMsg || 'Connexion impossible. Backend non disponible ?');
      // Diagnostic factuel (pas de secret) : endpoint exact + HTTP + code réseau.
      const endpoint = `POST ${API_URL}/api/auth/login/${mode}`;
      setDiag((d) => ({
        ...d,
        login: status
          ? `${endpoint} → HTTP ${status}${backendMsg ? ` · « ${backendMsg} »` : ''}`
          : `${endpoint} → échec réseau · ${code || 'inconnu'}${err.message ? ` · ${err.message}` : ''}`,
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin();
  };

  // Platform icon
  const PlatformIcon = device.isIPad ? Tablet : device.isWindows ? Monitor : Smartphone;
  const platformLabel = device.isIPad ? 'iPad' : device.isWindows ? 'Windows' : device.platform;

  return (
    <div className={`min-h-screen flex items-center justify-center bg-pos-bg relative overflow-hidden safe-area-top safe-area-bottom ${platformClasses(device)}`}>
      {/* Background gradient orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-pos-accent/5 blur-3xl" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-pos-accent-alt/5 blur-3xl" />

      <div className={`relative z-10 w-full mx-4 animate-scale-in ${device.isCompact ? 'max-w-[360px]' : 'max-w-sm'}`}>
        {/* Logo area */}
        <div className={`text-center ${device.isCompact ? 'mb-6' : 'mb-10'}`}>
          <div className={`inline-flex items-center justify-center rounded-3xl bg-pos-text mb-4 ${device.isTouch ? 'w-20 h-20' : 'w-16 h-16'}`}>
            <span className={`text-white font-black tracking-tighter ${device.isTouch ? 'text-3xl' : 'text-2xl'}`}>C</span>
          </div>
          <h1 className={`font-bold tracking-tight text-pos-text ${device.isTouch ? 'text-3xl' : 'text-2xl'}`}>
            Bienvenue
          </h1>
          <p className={`text-pos-muted mt-1 ${device.isTouch ? 'text-base' : 'text-sm'}`}>
            Identifiez-vous pour ouvrir la caisse
          </p>
          {/* Platform indicator */}
          <div className="flex items-center justify-center gap-1.5 mt-3 text-pos-muted/50">
            <PlatformIcon size={12} />
            <span className="text-[10px] font-medium uppercase tracking-wider">{platformLabel}</span>
          </div>
        </div>

        {/* Card */}
        <div className={`bg-white rounded-3xl shadow-elevated border border-pos-border/20 space-y-5 ${device.isTouch ? 'p-6 tablet:p-8' : 'p-7'}`}>
          {/* Mode toggle */}
          <div className="flex bg-pos-subtle rounded-2xl p-1">
            <button
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 ${device.isTouch ? 'py-3.5 text-base' : 'py-2.5 text-sm'} ${
                mode === 'pin'
                  ? 'bg-white shadow-soft text-pos-text'
                  : 'text-pos-muted hover:text-pos-text'
              }`}
              onClick={() => setMode('pin')}
            >
              <Lock size={device.isTouch ? 18 : 14} />
              Code PIN
            </button>
            <button
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 ${device.isTouch ? 'py-3.5 text-base' : 'py-2.5 text-sm'} ${
                mode === 'qr'
                  ? 'bg-white shadow-soft text-pos-text'
                  : 'text-pos-muted hover:text-pos-text'
              }`}
              onClick={() => setMode('qr')}
            >
              <QrCode size={device.isTouch ? 18 : 14} />
              QR Code
            </button>
          </div>

          {/* Form */}
          <div className={`${device.isTouch ? 'space-y-4' : 'space-y-3'}`}>
            {mode === 'pin' ? (
              <div className="relative">
                <Store size={device.isTouch ? 22 : 18} className="absolute left-4 top-1/2 -translate-y-1/2 text-pos-muted/50" />
                <input
                  type="text"
                  placeholder="ID Magasin"
                  className={`input-field ${device.isTouch ? 'pl-12 text-lg' : 'pl-11'}`}
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                />
              </div>
            ) : (
              <input
                type="text"
                placeholder="Scanner QR employe..."
                className="scan-input text-base"
                value={qrCode}
                onChange={(e) => setQrCode(e.target.value)}
                autoFocus
              />
            )}
            <div className="relative">
              <Lock size={device.isTouch ? 22 : 18} className="absolute left-4 top-1/2 -translate-y-1/2 text-pos-muted/50" />
              <input
                ref={pinRef}
                type="password"
                placeholder="&#9679; &#9679; &#9679; &#9679;"
                className={`input-field text-center font-mono ${device.isTouch ? 'pl-12 text-2xl tracking-[0.5em]' : 'pl-11 text-xl tracking-[0.4em]'}`}
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                onKeyDown={handleKeyDown}
              />
            </div>
          </div>

          {error && (
            <div className="bg-pos-danger/5 text-pos-danger rounded-2xl px-4 py-3 text-sm text-center font-medium animate-slide-up">
              {error}
            </div>
          )}

          <button
            className={`btn-primary w-full flex items-center justify-center gap-2 ${device.isTouch ? 'text-lg py-4' : 'text-base py-3.5'}`}
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <span className="animate-pulse-soft">Connexion...</span>
            ) : (
              <>
                Se connecter
                <ArrowRight size={device.isTouch ? 22 : 18} />
              </>
            )}
          </button>

          {/* Hide keyboard hint on touch */}
          {!device.isTouch && (
            <p className="text-center text-xs text-pos-muted/60">
              Appuyez sur <kbd>Entree</kbd> pour valider
            </p>
          )}

          {/* Diagnostic terrain (toujours visible, sans secret) — version réelle,
              URL backend, healthcheck renderer(CORS) vs main(sans CORS), et détail
              de la dernière tentative de login. Sert de preuve depuis le .exe. */}
          <div className="pt-2 border-t border-pos-border/10 space-y-1.5 text-[10px] font-mono text-pos-muted/70 leading-relaxed">
            <div className="flex items-center justify-between gap-2">
              <span>Diagnostic</span>
              <button
                type="button"
                onClick={runDiagnostics}
                disabled={probing}
                className="shrink-0 font-sans text-[11px] font-medium text-pos-accent hover:underline disabled:opacity-50"
              >
                {probing ? 'Test…' : 'Retester'}
              </button>
            </div>
            <div>Version&nbsp;: <b className={posVersion === '1.0.4' ? 'text-pos-text' : 'text-pos-danger'}>{posVersion || 'web/dev'}</b></div>
            <div className="break-all">Backend&nbsp;: {API_URL || '(URL absente)'}</div>
            <div>Health (renderer/CORS)&nbsp;: {diag.rendererHealth ?? '—'}</div>
            <div>Health (main/sans CORS)&nbsp;: {diag.mainHealth ?? '—'}</div>
            {diag.login && <div className="break-all text-pos-danger/90">Login&nbsp;: {diag.login}</div>}
          </div>
        </div>

      </div>

      {/* Dev platform info */}
      {location.hostname === 'localhost' && (
        <div className="fixed bottom-1 right-1 z-[9999] text-[9px] font-mono text-pos-muted/40 pointer-events-none">
          {device.platform} | {device.inputMode} | {device.screenClass} | {device.viewportWidth}x{device.viewportHeight}
        </div>
      )}
    </div>
  );
}
