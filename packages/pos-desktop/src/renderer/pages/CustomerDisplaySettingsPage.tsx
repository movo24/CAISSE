import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Monitor, Power, RefreshCw, Eye, ScanSearch, Grid3x3, ShoppingCart,
  MoonStar, Upload, Trash2, CheckCircle2, AlertTriangle, ArrowLeft, Video, Wifi, WifiOff,
  Activity, ClipboardCopy,
} from 'lucide-react';
import {
  loadSettings, saveSettings, terminalLabel,
  CUSTOMER_DISPLAY_MODES, CUSTOMER_DISPLAY_QR_TYPES,
  type CustomerDisplaySettings,
} from '../services/customerDisplay/settings';
import { getCustomerDisplayBus } from '../services/customerDisplay/bus';
import {
  validateMediaFile, probeVideoRatio, safeFileName, formatBytes,
  DEFAULT_MAX_VIDEO_BYTES,
} from '../services/customerDisplay/media';
import { putMedia, deleteMedia, getMedia } from '../services/customerDisplay/mediaStore';
import { buildDiagnosticReport, getPublishState } from '../services/customerDisplay/diagnostics';
import type { NativeDisplayStatus } from '../types/customer-display-native';

/**
 * Customer Display control panel (Dashboard POS > Écran client).
 *
 * Drives screen 2 end-to-end: activation, power (on / blackout / reload / test),
 * physical-screen identification & selection, display mode, idle-video upload
 * with 9:16 validation, QR + branding, timeouts, live status and field
 * diagnostics. Physical-window actions use the Electron bridge when present and
 * degrade gracefully on the web build.
 */
const SCREEN_STATUS_LABEL: Record<string, string> = {
  connected: 'Connecté',
  absent: 'Absent',
  'wrong-screen': 'Mauvais écran',
  fallback: 'Écran de secours',
};

export function CustomerDisplaySettingsPage() {
  const navigate = useNavigate();
  const native = typeof window !== 'undefined' ? window.customerDisplayNative : undefined;
  const bus = getCustomerDisplayBus();

  const [settings, setSettings] = useState<CustomerDisplaySettings>(() => loadSettings());
  const [nativeStatus, setNativeStatus] = useState<NativeDisplayStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [displayRes, setDisplayRes] = useState<string | null>(null);
  const [mediaMeta, setMediaMeta] = useState<{ name: string; size: number; resolution: string } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const connectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  /** Persist + normalise + broadcast config to the display. */
  const update = useCallback((patch: Partial<CustomerDisplaySettings>) => {
    setSettings((prev) => {
      const normalized = saveSettings({ ...prev, ...patch });
      bus.post({ type: 'config', settings: normalized });
      return normalized;
    });
  }, [bus]);

  // ── Native status + display heartbeat ──
  useEffect(() => {
    let cancelled = false;
    const refreshNative = () => {
      native?.getStatus?.().then((s) => {
        if (!cancelled) setNativeStatus(s);
      }).catch(() => {});
    };
    refreshNative();
    const offStatus = native?.onStatus?.((s) => setNativeStatus(s));

    const offBus = bus.subscribe((msg) => {
      if (msg.type === 'hello') {
        setConnected(true);
        setLastSeen(msg.at);
        setDisplayRes(msg.resolution);
        if (connectionTimer.current) clearTimeout(connectionTimer.current);
        // If no heartbeat within 15s, consider the display disconnected.
        connectionTimer.current = setTimeout(() => setConnected(false), 15000);
      }
    });

    // Ask the display to announce itself, then poll gently.
    bus.post({ type: 'command', command: 'ping' });
    const ping = setInterval(() => bus.post({ type: 'command', command: 'ping' }), 6000);

    // Load current media metadata for display.
    if (settings.mediaId) {
      getMedia(settings.mediaId).then((m) => {
        if (!cancelled && m) setMediaMeta({ name: m.name, size: m.size, resolution: `${m.width}x${m.height}` });
      });
    }

    return () => {
      cancelled = true;
      offStatus?.();
      offBus();
      clearInterval(ping);
      if (connectionTimer.current) clearTimeout(connectionTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Power / lifecycle ──
  const handleEnabledToggle = (enabled: boolean) => {
    update({ enabled });
    native?.setEnabled?.(enabled).then(setNativeStatus).catch(() => {});
    if (!native && enabled) openWeb();
  };

  const openWeb = () => window.open('/client-display', 'caisse-customer-display', 'width=540,height=960');

  const handleOpen = () => {
    if (native) native.open().then(setNativeStatus).catch(() => {});
    else openWeb();
    flash('Écran client allumé');
  };

  const handleBlackout = (blackout: boolean) => {
    update({ blackout });
    flash(blackout ? 'Écran noir activé' : 'Écran noir désactivé');
  };

  const handleReload = () => {
    if (native) native.reload().then(setNativeStatus).catch(() => {});
    bus.post({ type: 'command', command: 'ping' });
    flash('Écran client relancé');
  };

  const handleIdentify = () => {
    bus.post({ type: 'command', command: 'identify', seconds: 10 });
    flash('Identification affichée sur l’écran client (10 s)');
  };

  const handleSelectScreen = (id: number | null) => {
    update({ screenId: id });
    native?.setScreen?.(id).then(setNativeStatus).catch(() => {});
  };

  const command = (c: 'test_pattern' | 'test_cart' | 'force_idle') => {
    bus.post({ type: 'command', command: c });
    flash(
      c === 'test_pattern' ? 'Mire 9:16 affichée' :
      c === 'test_cart' ? 'Panier de test affiché' : 'Retour à l’écran idle',
    );
  };

  // ── Field diagnostic report ──
  const gatherReport = (): string => {
    const desktop = window.posDesktop;
    const primary = nativeStatus?.displays?.find((d) => d.isPrimary) || null;
    const selected =
      nativeStatus?.displays?.find((d) => d.id === (nativeStatus.screenId ?? -1)) ||
      nativeStatus?.displays?.find((d) => !d.isPrimary) ||
      null;
    let localOk = false;
    try {
      localStorage.setItem('__cd_probe', '1');
      localStorage.removeItem('__cd_probe');
      localOk = true;
    } catch { localOk = false; }
    return buildDiagnosticReport({
      appVersion: desktop?.version || 'web',
      platform: desktop?.platform || (typeof navigator !== 'undefined' ? navigator.platform : 'unknown'),
      mode: import.meta.env.DEV ? 'development' : 'production',
      isDesktop: !!desktop?.isDesktop,
      userDataPath: nativeStatus?.userDataPath ?? null,
      storage: { indexedDb: typeof indexedDB !== 'undefined', localSettings: localOk },
      display: {
        count: nativeStatus?.displayCount ?? 0,
        primaryResolution: primary?.resolution ?? null,
        selectedResolution: nativeStatus?.resolution ?? selected?.resolution ?? null,
        scaleFactor: selected?.scaleFactor ?? null,
        screenStatus: nativeStatus?.screenStatus ?? null,
        selectionReason: nativeStatus?.selectionReason ?? null,
        windowOpen: native ? (nativeStatus?.windowOpen ?? false) : null,
      },
      sync: {
        channelActive: bus.isActive,
        invalidPayloadCount: bus.invalidPayloadCount,
        lastDisplayHelloAt: lastSeen,
        lastDisplayResolution: displayRes,
      },
      publish: getPublishState(),
      settings: {
        enabled: settings.enabled,
        blackout: settings.blackout,
        mode: settings.mode,
        terminalId: settings.terminalId,
        hasVideo: !!settings.mediaId,
      },
      generatedAt: new Date().toISOString(),
    });
  };

  const handleGenerateReport = async () => {
    const text = gatherReport();
    setReport(text);
    try {
      await navigator.clipboard.writeText(text);
      flash('Rapport copié dans le presse-papier');
    } catch {
      flash('Rapport généré (copie manuelle ci-dessous)');
    }
  };

  // ── Video upload ──
  const handleVideoFile = async (file: File | undefined) => {
    if (!file) return;
    setMediaError(null);
    const envelope = validateMediaFile({ type: file.type, size: file.size, name: file.name }, DEFAULT_MAX_VIDEO_BYTES);
    if (!envelope.ok) {
      setMediaError(envelope.message || 'Fichier invalide');
      return;
    }
    setUploading(true);
    try {
      const ratio = await probeVideoRatio(file);
      if (!ratio.ok) {
        setMediaError(ratio.message || 'Format vidéo non vertical');
        setUploading(false);
        return;
      }
      const id = `vid-${crypto.randomUUID()}`;
      const dims = await readDimensions(file);
      const ok = await putMedia({
        id, blob: file, name: safeFileName(file.name), mime: file.type,
        size: file.size, width: dims.width, height: dims.height,
        createdAt: new Date().toISOString(),
      });
      if (!ok) {
        setMediaError('Stockage vidéo impossible sur ce terminal.');
        setUploading(false);
        return;
      }
      // Remove the previous media to avoid orphan blobs.
      if (settings.mediaId && settings.mediaId !== id) deleteMedia(settings.mediaId);
      update({ mediaId: id });
      setMediaMeta({ name: safeFileName(file.name), size: file.size, resolution: `${dims.width}x${dims.height}` });
      flash('Vidéo importée');
    } catch {
      setMediaError('Import vidéo impossible.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDeleteVideo = () => {
    if (settings.mediaId) deleteMedia(settings.mediaId);
    update({ mediaId: null });
    setMediaMeta(null);
    flash('Vidéo supprimée');
  };

  const displays = nativeStatus?.displays || [];

  return (
    <div className="min-h-screen bg-pos-bg text-pos-text">
      <div className="mx-auto max-w-3xl px-5 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <button className="btn-ghost !px-3" onClick={() => navigate('/pos')} aria-label="Retour">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Monitor className="text-pos-accent" size={26} />
            <h1 className="text-2xl font-black">Écran client</h1>
          </div>
        </div>

        {/* Status */}
        <div className="card mb-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-pos-muted">État</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <StatusRow label="Liaison" value={connected ? 'Connecté' : 'En attente'} good={connected}
              icon={connected ? <Wifi size={16} /> : <WifiOff size={16} />} />
            <StatusRow label="Activation" value={settings.enabled ? 'Activé' : 'Désactivé'} good={settings.enabled} />
            <StatusRow label="Fenêtre" value={native ? (nativeStatus?.windowOpen ? 'Ouverte' : 'Fermée') : 'Web'} good={!native || !!nativeStatus?.windowOpen} />
            {native && (
              <StatusRow
                label="Écran physique"
                value={SCREEN_STATUS_LABEL[nativeStatus?.screenStatus || 'absent']}
                good={nativeStatus?.screenStatus === 'connected'}
              />
            )}
            <StatusRow label="Écran noir" value={settings.blackout ? 'Oui' : 'Non'} good={!settings.blackout} />
            <StatusRow label="Résolution" value={displayRes || nativeStatus?.resolution || '—'} good />
            <StatusRow label="Terminal lié" value={terminalLabel(settings.terminalId)} good />
          </div>
          {lastSeen && (
            <p className="mt-3 text-xs text-pos-muted">Dernière synchro : {new Date(lastSeen).toLocaleTimeString('fr-FR')}</p>
          )}
          {!native && (
            <p className="mt-2 text-xs text-amber-600">
              Mode web : la gestion physique de l’écran (sélection, plein écran) nécessite l’app desktop.
            </p>
          )}
        </div>

        {/* Activation + power */}
        <div className="card mb-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-pos-muted">Alimentation</h2>
          <Toggle label="Activer l’écran client" checked={settings.enabled} onChange={handleEnabledToggle} />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ActionBtn icon={<Power size={18} />} label="Allumer" onClick={handleOpen} />
            <ActionBtn icon={<MoonStar size={18} />} label={settings.blackout ? 'Rallumer' : 'Écran noir'}
              onClick={() => handleBlackout(!settings.blackout)} active={settings.blackout} />
            <ActionBtn icon={<RefreshCw size={18} />} label="Relancer" onClick={handleReload} />
            <ActionBtn icon={<ScanSearch size={18} />} label="Identifier" onClick={handleIdentify} />
          </div>
        </div>

        {/* Physical screen selection */}
        {native && (
          <div className="card mb-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-pos-muted">Écran physique</h2>
            <div className="space-y-2">
              {displays.length === 0 && <p className="text-sm text-pos-muted">Aucun écran détecté.</p>}
              {displays.map((d) => (
                <button
                  key={d.id}
                  onClick={() => handleSelectScreen(d.id)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                    (settings.screenId ?? null) === d.id || (settings.screenId == null && !d.isPrimary)
                      ? 'border-pos-accent bg-pos-accent/5'
                      : 'border-pos-border/50 hover:bg-pos-subtle'
                  }`}
                >
                  <span className="font-semibold">{d.label}</span>
                  <span className="font-mono text-sm text-pos-muted">{d.resolution}</span>
                </button>
              ))}
              <button onClick={() => handleSelectScreen(null)} className="text-xs text-pos-accent underline">
                Détection automatique (écran secondaire)
              </button>
            </div>
            <div className="mt-3 flex gap-4">
              <Toggle label="Plein écran" checked={nativeStatus?.fullscreen ?? true}
                onChange={(v) => native.setFullscreen?.(v).then(setNativeStatus)} />
              <Toggle label="Kiosque" checked={nativeStatus?.kiosk ?? false}
                onChange={(v) => native.setKiosk?.(v).then(setNativeStatus)} />
            </div>
          </div>
        )}

        {/* Display mode */}
        <div className="card mb-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-pos-muted">Mode d’affichage</h2>
          <select className="input-field" value={settings.mode}
            onChange={(e) => update({ mode: e.target.value as CustomerDisplaySettings['mode'] })}>
            {CUSTOMER_DISPLAY_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        {/* Idle video */}
        <div className="card mb-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-pos-muted">
            <Video size={16} /> Vidéo idle (9:16)
          </h2>
          <input ref={fileRef} type="file" accept="video/mp4,video/webm" className="hidden"
            onChange={(e) => handleVideoFile(e.target.files?.[0])} />
          {mediaMeta ? (
            <div className="mb-3 flex items-center justify-between rounded-2xl bg-pos-subtle px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{mediaMeta.name}</p>
                <p className="text-xs text-pos-muted">{mediaMeta.resolution} · {formatBytes(mediaMeta.size)}</p>
              </div>
              <button className="btn-ghost !px-3 text-pos-danger" onClick={handleDeleteVideo} aria-label="Supprimer">
                <Trash2 size={18} />
              </button>
            </div>
          ) : (
            <p className="mb-3 text-sm text-pos-muted">Aucune vidéo. Format recommandé : MP4/WebM, 1080×1920.</p>
          )}
          <button className="btn-primary flex items-center gap-2" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload size={18} /> {uploading ? 'Validation…' : mediaMeta ? 'Remplacer la vidéo' : 'Importer une vidéo'}
          </button>
          {mediaError && (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-pos-danger/10 px-3 py-2 text-sm text-pos-danger">
              <AlertTriangle size={16} /> {mediaError}
            </p>
          )}
        </div>

        {/* QR + branding */}
        <div className="card mb-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-pos-muted">QR & branding</h2>
          <Toggle label="Afficher un QR code" checked={settings.showQr} onChange={(v) => update({ showQr: v })} />
          {settings.showQr && (
            <div className="mt-3 space-y-3">
              <select className="input-field" value={settings.qrType}
                onChange={(e) => update({ qrType: e.target.value as CustomerDisplaySettings['qrType'] })}>
                {CUSTOMER_DISPLAY_QR_TYPES.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
              <input className="input-field" placeholder="https://…" value={settings.qrValue}
                onChange={(e) => update({ qrValue: e.target.value })} />
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-pos-muted">Nom du magasin</span>
              <input className="input-field" value={settings.storeName} onChange={(e) => update({ storeName: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-pos-muted">N° terminal</span>
              <input className="input-field" value={settings.terminalId} onChange={(e) => update({ terminalId: e.target.value })} />
            </label>
          </div>
        </div>

        {/* Timeouts */}
        <div className="card mb-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-pos-muted">Temporisations</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-pos-muted">Rotation idle (s)</span>
              <input type="number" min={3} max={120} className="input-field" value={settings.idleTimeoutSeconds}
                onChange={(e) => update({ idleTimeoutSeconds: Number(e.target.value) })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-pos-muted">Merci (s)</span>
              <input type="number" min={2} max={60} className="input-field" value={settings.successTimeoutSeconds}
                onChange={(e) => update({ successTimeoutSeconds: Number(e.target.value) })} />
            </label>
          </div>
        </div>

        {/* Diagnostics — actions terrain */}
        <div className="card mb-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-pos-muted">Diagnostic terrain</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ActionBtn icon={<Grid3x3 size={18} />} label="Mire 9:16" onClick={() => command('test_pattern')} />
            <ActionBtn icon={<ScanSearch size={18} />} label="N° terminal" onClick={handleIdentify} />
            <ActionBtn icon={<ShoppingCart size={18} />} label="Test panier" onClick={() => command('test_cart')} />
            <ActionBtn icon={<Eye size={18} />} label="Forcer idle" onClick={() => command('force_idle')} />
          </div>
        </div>

        {/* Diagnostic terminal — état + export */}
        <div className="card mb-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-pos-muted">
            <Activity size={16} /> Diagnostic terminal
          </h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <StatusRow label="Plateforme" value={window.posDesktop?.platform || 'web'} good />
            <StatusRow label="Version" value={window.posDesktop?.version || '—'} good />
            <StatusRow label="Mode" value={import.meta.env.DEV ? 'dev' : 'prod'} good={!import.meta.env.DEV} />
            <StatusRow label="IndexedDB" value={typeof indexedDB !== 'undefined' ? 'OK' : 'absent'} good={typeof indexedDB !== 'undefined'} />
            <StatusRow label="BroadcastChannel" value={bus.isActive ? 'actif' : 'inactif'} good={bus.isActive} />
            <StatusRow label="Payloads rejetés" value={String(bus.invalidPayloadCount)} good={bus.invalidPayloadCount === 0} />
            <StatusRow label="Écran (statut)" value={nativeStatus?.screenStatus || (native ? '—' : 'web')} good={!nativeStatus || nativeStatus.screenStatus === 'connected'} />
            <StatusRow label="Sélection" value={nativeStatus?.selectionReason || '—'} good />
          </div>
          {nativeStatus?.userDataPath && (
            <p className="mt-3 break-all text-xs text-pos-muted">userData : {nativeStatus.userDataPath}</p>
          )}
          <button className="btn-primary mt-3 flex items-center gap-2" onClick={handleGenerateReport}>
            <ClipboardCopy size={18} /> Générer &amp; copier le rapport
          </button>
          {report && (
            <textarea
              readOnly
              className="mt-3 h-64 w-full rounded-2xl border border-pos-border/60 bg-pos-subtle p-3 font-mono text-xs text-pos-text"
              value={report}
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-pos-text px-5 py-3 text-sm font-semibold text-white shadow-elevated flex items-center gap-2">
          <CheckCircle2 size={16} className="text-pos-success" /> {toast}
        </div>
      )}
    </div>
  );
}

// ── Small presentational helpers ──

function StatusRow({ label, value, good, icon }: { label: string; value: string; good: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-pos-subtle px-3 py-2">
      <span className="text-pos-muted">{label}</span>
      <span className={`flex items-center gap-1.5 font-semibold ${good ? 'text-pos-success' : 'text-amber-600'}`}>
        {icon} {value}
      </span>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="font-medium">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 rounded-full transition-colors ${checked ? 'bg-pos-accent' : 'bg-pos-border'}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </button>
    </label>
  );
}

function ActionBtn({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-2xl border px-3 py-3 text-xs font-semibold transition-colors ${
        active ? 'border-pos-accent bg-pos-accent text-white' : 'border-pos-border/50 hover:bg-pos-subtle'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** Probe intrinsic dimensions (browser). Returns {0,0} on failure — never throws. */
function readDimensions(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        const dims = { width: v.videoWidth, height: v.videoHeight };
        URL.revokeObjectURL(url);
        resolve(dims);
      };
      v.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: 0, height: 0 });
      };
      v.src = url;
    } catch {
      resolve({ width: 0, height: 0 });
    }
  });
}
