/**
 * ScannerTool — Inline barcode scanner with intelligent mode detection
 *
 * Priority order (pro → fallback):
 *  1. Bluetooth scanner gun (fastest, pro usage)
 *  2. USB/Keyboard wedge (auto-detected, no setup)
 *  3. Camera (fallback, requires HTTPS secure context)
 *  4. Manual entry (always available)
 *
 * Smart context detection:
 *  - Detects secure context (HTTPS) for camera availability
 *  - Shows clear messages when camera is blocked (HTTP on LAN)
 *  - Auto-selects best available mode
 *  - Never crashes regardless of context
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Camera, X, Bluetooth, BluetoothConnected, BluetoothOff, BluetoothSearching,
  ScanBarcode, SwitchCamera, Keyboard, Check, Trash2,
  BatteryLow, BatteryMedium, BatteryFull, Plus, Volume2, VolumeX,
  CheckCircle2, AlertCircle, Wifi, WifiOff, ShieldCheck, ShieldAlert,
  Info, Zap,
} from 'lucide-react';
import { useBluetoothScanner, BTScannerDevice } from '../../hooks/useBluetoothScanner';

/* ── Types ── */

type ScannerMode = 'camera' | 'manual' | 'bt-settings';

interface ScannerToolProps {
  /** Whether scanner is visible */
  open: boolean;
  onClose: () => void;
  /** Called when a barcode is detected (from any source) */
  onScan: (code: string, format: string) => void;
  isLandscape: boolean;
}

/* ── Context & availability detection ── */

interface ScannerCapabilities {
  /** True if running in a secure context (HTTPS or localhost) */
  isSecureContext: boolean;
  /** True if navigator.mediaDevices API is available */
  hasMediaDevices: boolean;
  /** True if BarcodeDetector API is available */
  hasBarcodeDetector: boolean;
  /** True if camera can be used (secure context + mediaDevices) */
  canUseCamera: boolean;
  /** True if Web Bluetooth API is available */
  hasWebBluetooth: boolean;
  /** Human-readable reason if camera is blocked */
  cameraBlockedReason: string | null;
  /** The protocol being used */
  protocol: string;
  /** The hostname */
  hostname: string;
}

function detectCapabilities(): ScannerCapabilities {
  const isSecureContext = typeof window !== 'undefined' && (
    window.isSecureContext === true ||
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  );

  const hasMediaDevices = !!(
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );

  const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  const hasWebBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  const canUseCamera = isSecureContext && hasMediaDevices;

  let cameraBlockedReason: string | null = null;
  if (!isSecureContext) {
    const host = typeof location !== 'undefined' ? location.hostname : 'unknown';
    cameraBlockedReason = `Contexte non securise (HTTP sur ${host}). La camera necessite HTTPS.`;
  } else if (!hasMediaDevices) {
    cameraBlockedReason = 'API MediaDevices non disponible dans ce navigateur.';
  } else if (!hasBarcodeDetector) {
    cameraBlockedReason = 'BarcodeDetector non supporte. Utilisez un pistolet scanner.';
  }

  return {
    isSecureContext,
    hasMediaDevices,
    hasBarcodeDetector,
    canUseCamera,
    hasWebBluetooth,
    cameraBlockedReason,
    protocol: typeof location !== 'undefined' ? location.protocol : 'unknown:',
    hostname: typeof location !== 'undefined' ? location.hostname : 'unknown',
  };
}

/* ── Sound feedback ── */

let audioCtx: AudioContext | null = null;
function playBeep() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.value = 1200;
    gain.gain.value = 0.12;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
    osc.stop(audioCtx.currentTime + 0.12);
  } catch { /* audio not available */ }
}

/* ══════════════════════════════════════════════════
   MAIN COMPONENT — Inline Scanner
   ══════════════════════════════════════════════════ */

export function ScannerTool({ open, onClose, onScan, isLandscape }: ScannerToolProps) {
  // Detect capabilities once
  const caps = useMemo(() => detectCapabilities(), []);

  // Auto-select best default mode
  const defaultMode: ScannerMode = caps.canUseCamera ? 'camera' : 'manual';

  // Camera
  const [mode, setMode] = useState<ScannerMode>(defaultMode);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownRef = useRef(false);

  // Bluetooth
  const bluetooth = useBluetoothScanner();
  const connectedBT = bluetooth.pairedScanners.filter(s => s.status === 'connected').length;

  // Manual input
  const [manualCode, setManualCode] = useState('');
  const manualRef = useRef<HTMLInputElement>(null);

  /* ── Handle any barcode result ── */

  const handleDetection = useCallback((code: string, format: string) => {
    if (cooldownRef.current) return;
    cooldownRef.current = true;
    setTimeout(() => { cooldownRef.current = false; }, 2000);

    setLastCode(code);
    setScanCount(c => c + 1);
    if (soundOn) playBeep();
    if (navigator.vibrate) navigator.vibrate(50);

    onScan(code, format);

    setTimeout(() => setLastCode(null), 2500);
  }, [onScan, soundOn]);

  /* ── Camera start/stop ── */

  const startCamera = useCallback(async () => {
    if (!caps.canUseCamera) {
      setCameraError(caps.cameraBlockedReason || 'Camera non disponible');
      return;
    }
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }

      // BarcodeDetector — continuous detection
      if (caps.hasBarcodeDetector) {
        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e'],
        });
        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              handleDetection(barcodes[0].rawValue, barcodes[0].format);
            }
          } catch { /* frame error */ }
        }, 150);
      } else {
        setCameraError('BarcodeDetector non supporte. Utilisez un pistolet scanner.');
      }
    } catch (e: any) {
      if (e.name === 'NotAllowedError') {
        setCameraError("Acces camera refuse. Autorisez dans Reglages > Safari.");
      } else if (e.name === 'NotFoundError') {
        setCameraError('Aucune camera trouvee.');
      } else if (e.name === 'NotReadableError') {
        setCameraError('Camera deja utilisee par une autre app.');
      } else {
        setCameraError(e.message || 'Erreur camera');
      }
    }
  }, [facingMode, handleDetection, caps]);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  // Lifecycle: start camera when in camera mode, stop otherwise
  useEffect(() => {
    if (open && mode === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [open, mode, facingMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bluetooth scans → forward to handler
  useEffect(() => {
    return bluetooth.onBarcodeScan((code) => {
      handleDetection(code, 'BT');
    });
  }, [bluetooth, handleDetection]);

  // Manual input focus
  useEffect(() => {
    if (mode === 'manual' && open) setTimeout(() => manualRef.current?.focus(), 100);
  }, [mode, open]);

  const handleManualSubmit = useCallback(() => {
    const code = manualCode.trim();
    if (code.length < 3) return;
    handleDetection(code, code.length === 13 ? 'EAN-13' : code.length === 8 ? 'EAN-8' : 'CODE-128');
    setManualCode('');
    manualRef.current?.focus();
  }, [manualCode, handleDetection]);

  if (!open) return null;

  return (
    <>
      {/* ═══ INLINE SCANNER — compact card ═══ */}
      <div className={`bg-white rounded-2xl border border-pos-border/20 shadow-lg overflow-hidden ${
        isLandscape ? 'mx-3 mb-1' : 'mx-3 mb-2'
      }`}>

        {/* ── Header bar ── */}
        <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-violet-100/50">
          <div className="flex items-center gap-2">
            <ScanBarcode size={15} className="text-violet-600" />
            <span className="text-xs font-bold text-violet-900">Scanner</span>
            {scanCount > 0 && (
              <span className="text-[10px] font-bold text-violet-500 bg-violet-100 px-1.5 py-0.5 rounded-full">
                {scanCount}
              </span>
            )}
            {/* Context indicator */}
            {caps.isSecureContext ? (
              <ShieldCheck size={11} className="text-emerald-500" />
            ) : (
              <ShieldAlert size={11} className="text-amber-500" />
            )}
            {/* Connected BT badge */}
            {connectedBT > 0 && (
              <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                <BluetoothConnected size={9} /> {connectedBT} BT
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Sound toggle */}
            <button
              onClick={() => setSoundOn(!soundOn)}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                soundOn ? 'text-violet-600 hover:bg-violet-100' : 'text-gray-300 hover:bg-gray-100'
              }`}
            >
              {soundOn ? <Volume2 size={13} /> : <VolumeX size={13} />}
            </button>

            {/* Mode: Camera (only if available) */}
            {caps.canUseCamera && (
              <button
                onClick={() => setMode('camera')}
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                  mode === 'camera' ? 'bg-violet-100 text-violet-600' : 'text-gray-400 hover:bg-gray-100'
                }`}
                title="Camera"
              >
                <Camera size={13} />
              </button>
            )}

            {/* Mode: Manual input */}
            <button
              onClick={() => setMode('manual')}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                mode === 'manual' ? 'bg-violet-100 text-violet-600' : 'text-gray-400 hover:bg-gray-100'
              }`}
              title="Saisie manuelle"
            >
              <Keyboard size={13} />
            </button>

            {/* Bluetooth settings */}
            <button
              onClick={() => setMode(mode === 'bt-settings' ? defaultMode : 'bt-settings')}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors relative ${
                mode === 'bt-settings' ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:bg-gray-100'
              }`}
              title="Pistolets Bluetooth"
            >
              <Bluetooth size={13} />
              {connectedBT > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border border-white" />
              )}
            </button>

            {/* Switch camera (only in camera mode) */}
            {mode === 'camera' && cameraReady && (
              <button
                onClick={() => { stopCamera(); setFacingMode(f => f === 'environment' ? 'user' : 'environment'); }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors"
              >
                <SwitchCamera size={13} />
              </button>
            )}

            {/* Debug info toggle */}
            <button
              onClick={() => setShowDebugInfo(!showDebugInfo)}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                showDebugInfo ? 'bg-amber-100 text-amber-600' : 'text-gray-300 hover:bg-gray-100'
              }`}
              title="Info debug"
            >
              <Info size={13} />
            </button>

            {/* Close */}
            <button
              onClick={() => { stopCamera(); onClose(); }}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Debug banner (toggleable) ── */}
        {showDebugInfo && (
          <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 text-[10px] font-mono text-amber-800 space-y-0.5">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1">
                {caps.isSecureContext ? <ShieldCheck size={10} className="text-emerald-500" /> : <ShieldAlert size={10} className="text-red-500" />}
                Contexte: {caps.isSecureContext ? 'Securise' : 'NON securise'}
              </span>
              <span>Proto: {caps.protocol}</span>
              <span>Host: {caps.hostname}</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={caps.hasMediaDevices ? 'text-emerald-700' : 'text-red-600'}>
                MediaDevices: {caps.hasMediaDevices ? 'OK' : 'NON'}
              </span>
              <span className={caps.hasBarcodeDetector ? 'text-emerald-700' : 'text-red-600'}>
                BarcodeDetector: {caps.hasBarcodeDetector ? 'OK' : 'NON'}
              </span>
              <span className={caps.hasWebBluetooth ? 'text-emerald-700' : 'text-amber-600'}>
                WebBT: {caps.hasWebBluetooth ? 'OK' : 'NON'}
              </span>
              <span className={caps.canUseCamera ? 'text-emerald-700' : 'text-red-600'}>
                Camera: {caps.canUseCamera ? 'PRETE' : 'BLOQUEE'}
              </span>
            </div>
            {caps.cameraBlockedReason && (
              <div className="text-red-600 font-semibold">
                Raison: {caps.cameraBlockedReason}
              </div>
            )}
          </div>
        )}

        {/* ── Content area ── */}
        {mode === 'camera' ? (
          /* ─── CAMERA MODE ─── */
          <div className="relative bg-black" style={{ height: isLandscape ? '140px' : '160px' }}>
            {cameraError ? (
              <div className="absolute inset-0 flex items-center justify-center gap-3 px-4">
                <AlertCircle size={20} className="text-amber-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white/90 text-xs font-medium">{cameraError}</p>
                  <div className="flex gap-2 mt-1.5">
                    <button
                      onClick={startCamera}
                      className="text-violet-300 text-[11px] font-semibold hover:text-violet-200"
                    >
                      Reessayer
                    </button>
                    <button
                      onClick={() => setMode('manual')}
                      className="text-amber-300 text-[11px] font-semibold hover:text-amber-200"
                    >
                      Saisie manuelle
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {/* Scan guide overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute left-[8%] right-[8%] top-1/2 -translate-y-1/2">
                    <div className="relative h-16 -mt-8">
                      <div className="absolute top-0 left-0 w-5 h-5" style={{ borderTop: '2px solid rgba(255,255,255,0.8)', borderLeft: '2px solid rgba(255,255,255,0.8)', borderRadius: '4px 0 0 0' }} />
                      <div className="absolute top-0 right-0 w-5 h-5" style={{ borderTop: '2px solid rgba(255,255,255,0.8)', borderRight: '2px solid rgba(255,255,255,0.8)', borderRadius: '0 4px 0 0' }} />
                      <div className="absolute bottom-0 left-0 w-5 h-5" style={{ borderBottom: '2px solid rgba(255,255,255,0.8)', borderLeft: '2px solid rgba(255,255,255,0.8)', borderRadius: '0 0 0 4px' }} />
                      <div className="absolute bottom-0 right-0 w-5 h-5" style={{ borderBottom: '2px solid rgba(255,255,255,0.8)', borderRight: '2px solid rgba(255,255,255,0.8)', borderRadius: '0 0 4px 0' }} />
                      <div className="absolute left-1 right-1 h-[2px] bg-gradient-to-r from-transparent via-violet-400/80 to-transparent scanner-line-anim" />
                    </div>
                  </div>
                </div>
                {lastCode && (
                  <div className="absolute inset-0 bg-emerald-400/25 pointer-events-none" style={{ animation: 'scanner-flash 0.4s ease-out' }} />
                )}
              </>
            )}

            {/* Detected barcode badge */}
            {lastCode && (
              <div className="absolute bottom-2 left-2 right-2 flex justify-center">
                <div className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md">
                  <CheckCircle2 size={13} />
                  {lastCode}
                </div>
              </div>
            )}
          </div>
        ) : mode === 'manual' ? (
          /* ─── MANUAL MODE ─── */
          <div className="px-3 py-3">
            {/* Camera unavailable info banner */}
            {!caps.canUseCamera && (
              <div className="mb-2.5 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 flex items-start gap-2">
                <ShieldAlert size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-amber-800">Camera indisponible</p>
                  <p className="text-[10px] text-amber-600 mt-0.5 leading-relaxed">
                    {!caps.isSecureContext
                      ? `Page chargee en HTTP (${caps.hostname}). Safari bloque la camera sans HTTPS. Utilisez un pistolet scanner ou la saisie manuelle.`
                      : caps.cameraBlockedReason || 'API camera non disponible.'
                    }
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <input
                ref={manualRef}
                type="text"
                inputMode="numeric"
                className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm font-mono font-bold text-center focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400"
                placeholder="Code EAN / code-barres..."
                value={manualCode}
                onChange={e => setManualCode(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleManualSubmit(); }}
              />
              <button
                onClick={handleManualSubmit}
                disabled={manualCode.trim().length < 3}
                className="px-4 py-2.5 rounded-xl bg-violet-500 text-white font-bold text-sm disabled:opacity-30 hover:bg-violet-600 transition-all product-card-touch"
              >
                <Check size={16} />
              </button>
            </div>

            {/* Last scanned badge */}
            {lastCode && (
              <div className="mt-2 flex justify-center">
                <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold flex items-center gap-1.5">
                  <CheckCircle2 size={13} />
                  {lastCode}
                </div>
              </div>
            )}

            {/* Keyboard wedge tip */}
            <div className="mt-2 rounded-lg bg-violet-50/50 border border-violet-100/50 px-2.5 py-1.5">
              <p className="text-[10px] text-violet-600 flex items-center gap-1.5">
                <Zap size={10} />
                <span>
                  <strong>Tip :</strong> Un pistolet scanner USB/BT en mode clavier fonctionne directement.
                  Scannez vers ce champ ou n'importe quel champ de la page.
                </span>
              </p>
            </div>
          </div>
        ) : (
          /* ─── BLUETOOTH SETTINGS MODE ─── */
          <div className="p-3 space-y-2.5 max-h-[280px] overflow-y-auto cart-scroll">
            {/* Pair button */}
            {bluetooth.isSupported ? (
              <button
                onClick={bluetooth.startPairing}
                disabled={bluetooth.pairingStatus === 'searching' || bluetooth.pairingStatus === 'connecting'}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-xs transition-all product-card-touch ${
                  bluetooth.pairingStatus === 'searching' || bluetooth.pairingStatus === 'connecting'
                    ? 'bg-blue-50 text-blue-400'
                    : 'bg-blue-500 text-white shadow-sm hover:bg-blue-600'
                }`}
              >
                {bluetooth.pairingStatus === 'searching' ? (
                  <><BluetoothSearching size={14} className="animate-pulse" /> Recherche...</>
                ) : bluetooth.pairingStatus === 'connecting' ? (
                  <><BluetoothConnected size={14} className="animate-pulse" /> Connexion...</>
                ) : (
                  <><Plus size={14} /> Connecter un pistolet</>
                )}
              </button>
            ) : (
              <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-[11px] text-amber-700 font-medium flex items-start gap-2">
                <BluetoothOff size={13} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Web Bluetooth non disponible</p>
                  <p className="text-[10px] text-amber-600 mt-0.5">
                    {!caps.isSecureContext
                      ? 'HTTPS requis pour le Web Bluetooth. Les pistolets en mode clavier (HID) fonctionnent quand meme.'
                      : 'Ce navigateur ne supporte pas le Web Bluetooth. Les pistolets en mode clavier fonctionnent quand meme.'
                    }
                  </p>
                </div>
              </div>
            )}

            {/* Error */}
            {bluetooth.error && (
              <div className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[10px] text-red-500 font-medium">
                {bluetooth.error}
              </div>
            )}

            {/* Paired scanners */}
            {bluetooth.pairedScanners.map(scanner => (
              <div key={scanner.id} className={`rounded-xl border p-2.5 ${
                scanner.status === 'connected'
                  ? 'bg-emerald-50/50 border-emerald-200'
                  : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    scanner.status === 'connected' ? 'bg-emerald-100' : 'bg-gray-200'
                  }`}>
                    {scanner.status === 'connected'
                      ? <BluetoothConnected size={14} className="text-emerald-600" />
                      : <BluetoothOff size={14} className="text-gray-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-900 truncate">{scanner.name}</p>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] font-semibold ${
                        scanner.status === 'connected' ? 'text-emerald-600' : 'text-gray-400'
                      }`}>
                        {scanner.status === 'connected' ? 'Connecte' : 'Deconnecte'}
                      </span>
                      {scanner.batteryLevel !== undefined && (
                        <span className="flex items-center gap-0.5 text-[9px] text-gray-400">
                          {scanner.batteryLevel > 60 ? <BatteryFull size={9} className="text-emerald-500" />
                           : scanner.batteryLevel > 20 ? <BatteryMedium size={9} className="text-amber-500" />
                           : <BatteryLow size={9} className="text-red-500" />}
                          {scanner.batteryLevel}%
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => bluetooth.removePairedScanner(scanner.id)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}

            {/* Empty state */}
            {bluetooth.pairedScanners.length === 0 && bluetooth.isSupported && (
              <p className="text-[10px] text-gray-400 text-center py-2">
                Aucun pistolet connecte via Web Bluetooth.<br />
                Zebra, Honeywell, Datalogic, Socket Mobile...
              </p>
            )}

            {/* Keyboard wedge info */}
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-2">
              <p className="text-[10px] text-gray-500">
                <strong>Mode clavier (HID) :</strong> Les pistolets USB ou Bluetooth en mode clavier fonctionnent
                automatiquement sans configuration. Scannez un code-barres, il s'ajoute au panier directement.
              </p>
            </div>

            {/* Pro recommendation */}
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-2.5 py-2">
              <p className="text-[10px] text-blue-700">
                <strong>Recommandation pro :</strong> Un pistolet scanner Bluetooth (Zebra CS60, Socket Mobile S740)
                est 10x plus rapide et fiable que la camera iPad. C'est l'outil de reference en magasin.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Inline CSS for scan line animation ── */}
      <style>{`
        @keyframes scanner-sweep {
          0%, 100% { top: 15%; }
          50% { top: 80%; }
        }
        .scanner-line-anim {
          position: absolute;
          animation: scanner-sweep 2s ease-in-out infinite;
        }
      `}</style>
    </>
  );
}
