// ── ScannerOverlay ───────────────────────────────────────────────
// Fullscreen camera scanner with viewfinder
//
// Both native BarcodeDetector and ZXing render into the same <video>
// element, so we use a single unified layout for both modes.
//
// Debug panel (🐛 icon) shows real-time scanner state on device.
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft, Flashlight, FlashlightOff, ScanBarcode,
  Keyboard, CheckCircle2, X, Loader2, Bug,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useScanner, ScanResult } from '../hooks/useScanner';
import { useAuthStore } from '../stores/authStore';

interface ScannerOverlayProps {
  title: string;
  onScan: (result: ScanResult) => void;
  continuous?: boolean;
  bottomContent?: React.ReactNode;
}

export function ScannerOverlay({
  title,
  onScan,
  continuous = false,
  bottomContent,
}: ScannerOverlayProps) {
  const navigate = useNavigate();
  const storeInfo = useAuthStore((s) => s.storeInfo);
  const [showManual, setShowManual] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [showFlash, setShowFlash] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const cameraStarted = useRef(false);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleScan = useCallback(
    (result: ScanResult) => {
      if (!mountedRef.current) return;
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      setShowFlash(true);
      flashTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) setShowFlash(false);
        flashTimeoutRef.current = null;
      }, 300);
      onScan(result);
    },
    [onScan],
  );

  const {
    videoRef,
    isActive,
    usingFallback,
    startCamera,
    stopCamera,
    cameraError,
    torchAvailable,
    torchOn,
    toggleTorch,
    onManualSubmit,
    lastScan,
    scanCount,
    debugLog,
  } = useScanner({ onScan: handleScan, continuous });

  useEffect(() => {
    if (!cameraStarted.current) {
      cameraStarted.current = true;
      startCamera();
    }
    return () => { stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualSubmit = () => {
    const code = manualCode.trim();
    if (code.length >= 3) {
      onManualSubmit(code);
      setManualCode('');
      if (!continuous) setShowManual(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Video layer — used by BOTH native and ZXing modes */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Dark overlay with viewfinder cutout */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-[28%] bg-black/50" />
        <div className="absolute bottom-0 left-0 right-0 h-[32%] bg-black/50" />
        <div className="absolute top-[28%] bottom-[32%] left-0 w-[8%] bg-black/50" />
        <div className="absolute top-[28%] bottom-[32%] right-0 w-[8%] bg-black/50" />
      </div>

      {/* Green flash on scan */}
      {showFlash && (
        <div className="absolute inset-0 bg-emerald-400/30 pointer-events-none scan-flash" />
      )}

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-3 pb-2 safe-top">
        <button
          onClick={() => { stopCamera(); navigate(-1); }}
          className="w-10 h-10 rounded-xl bg-black/60 backdrop-blur flex items-center justify-center text-white active:scale-95 transition-transform"
        >
          <ArrowLeft size={20} />
        </button>

        <div className="text-center">
          <h1 className="text-white font-bold text-base drop-shadow-lg">{title}</h1>
          {storeInfo?.name && (
            <p className="text-white/60 text-[10px] font-medium">{storeInfo.name}</p>
          )}
        </div>

        <div className="flex gap-1">
          {/* Debug toggle */}
          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`w-10 h-10 rounded-xl backdrop-blur flex items-center justify-center transition-colors ${
              showDebug ? 'bg-amber-500/80 text-black' : 'bg-black/60 text-white/50'
            }`}
          >
            <Bug size={16} />
          </button>
          {/* Torch */}
          <button
            onClick={toggleTorch}
            disabled={!torchAvailable}
            className={`w-10 h-10 rounded-xl backdrop-blur flex items-center justify-center transition-colors ${
              torchOn
                ? 'bg-yellow-400/80 text-black'
                : 'bg-black/60 text-white disabled:opacity-30'
            }`}
          >
            {torchOn ? <FlashlightOff size={18} /> : <Flashlight size={18} />}
          </button>
        </div>
      </div>

      {/* Camera loading */}
      {!isActive && !cameraError && (
        <div className="relative z-10 flex items-center justify-center mt-8">
          <div className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-black/60 backdrop-blur text-white text-sm">
            <Loader2 size={16} className="animate-spin" />
            Demarrage camera...
          </div>
        </div>
      )}

      {/* Mode indicator + instruction */}
      {isActive && (
        <div className="relative z-10 text-center mt-2">
          <p className="text-white/80 text-sm font-medium drop-shadow">
            Placez le code-barres dans le cadre
          </p>
          <div className="flex items-center justify-center gap-2 mt-1">
            <ScanBarcode size={16} className="text-white/50" />
            <span className="text-white/40 text-[10px] font-mono">
              {usingFallback ? 'ZXing' : 'BarcodeDetector'}
            </span>
          </div>
        </div>
      )}

      {/* Viewfinder corners */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-[8%]">
        <div className="relative w-full" style={{ aspectRatio: '16/7' }}>
          <div className="absolute -top-1 -left-1 w-8 h-8 corner-pulse" style={{ borderTop: '3px solid #7c3aed', borderLeft: '3px solid #7c3aed', borderRadius: '6px 0 0 0' }} />
          <div className="absolute -top-1 -right-1 w-8 h-8 corner-pulse" style={{ borderTop: '3px solid #7c3aed', borderRight: '3px solid #7c3aed', borderRadius: '0 6px 0 0', animationDelay: '0.5s' }} />
          <div className="absolute -bottom-1 -left-1 w-8 h-8 corner-pulse" style={{ borderBottom: '3px solid #7c3aed', borderLeft: '3px solid #7c3aed', borderRadius: '0 0 0 6px', animationDelay: '1s' }} />
          <div className="absolute -bottom-1 -right-1 w-8 h-8 corner-pulse" style={{ borderBottom: '3px solid #7c3aed', borderRight: '3px solid #7c3aed', borderRadius: '0 0 6px 0', animationDelay: '1.5s' }} />
          <div className="absolute left-2 right-2 h-[2px] bg-gradient-to-r from-transparent via-violet-500/80 to-transparent scan-line" />
        </div>
      </div>

      {/* ── DEBUG PANEL ── */}
      {showDebug && (
        <div className="relative z-10 mx-3 mb-2 max-h-48 overflow-y-auto rounded-xl bg-black/80 backdrop-blur border border-amber-500/40 p-2">
          <p className="text-amber-400 text-[10px] font-bold mb-1">
            DEBUG — {usingFallback ? 'ZXing (iOS)' : 'BarcodeDetector (natif)'}
          </p>
          {debugLog.length === 0 ? (
            <p className="text-white/40 text-[9px] font-mono">En attente...</p>
          ) : (
            debugLog.map((line, i) => (
              <p key={i} className={`text-[9px] font-mono leading-tight ${
                line.includes('DETECTE') || line.includes('decode:') ? 'text-emerald-400 font-bold' :
                line.includes('ERREUR') || line.includes('ECHOUE') ? 'text-red-400' :
                line.includes('DEMARRE') || line.includes('active') ? 'text-blue-400' :
                'text-white/70'
              }`}>
                {line}
              </p>
            ))
          )}
        </div>
      )}

      {/* Camera error */}
      {cameraError && (
        <div className="relative z-10 mx-6 mb-3 px-4 py-3 rounded-2xl bg-red-500/20 backdrop-blur border border-red-400/30">
          <p className="text-white text-xs font-medium text-center">{cameraError}</p>
          <div className="flex justify-center gap-4 mt-2">
            <button
              onClick={() => {
                cameraStarted.current = false;
                startCamera();
              }}
              className="text-violet-300 text-xs font-bold"
            >
              Reessayer
            </button>
            <button
              onClick={() => setShowManual(true)}
              className="text-amber-300 text-xs font-bold"
            >
              Saisie manuelle
            </button>
          </div>
        </div>
      )}

      {/* Last scan badge */}
      {lastScan && (
        <div className="relative z-10 flex flex-col items-center gap-1 mb-2">
          <div className="px-4 py-2 rounded-xl bg-emerald-500/90 backdrop-blur text-white text-sm font-bold flex items-center gap-2 shadow-lg">
            <CheckCircle2 size={16} />
            Code lu : {lastScan.code}
          </div>
          <span className="text-white/40 text-[9px] font-mono">
            {lastScan.format} | {new Date(lastScan.timestamp).toLocaleTimeString('fr-FR')}
          </span>
        </div>
      )}

      {/* Bottom content */}
      {bottomContent && (
        <div className="relative z-10 px-4 mb-2">
          {bottomContent}
        </div>
      )}

      {/* Manual entry */}
      <div className="relative z-10 px-6 pb-4 safe-bottom">
        {showManual ? (
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              placeholder="Code EAN..."
              className="flex-1 px-4 py-3 rounded-2xl bg-white text-gray-900 font-mono font-bold text-center text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <button
              onClick={handleManualSubmit}
              disabled={manualCode.trim().length < 3}
              className="px-5 py-3 rounded-2xl bg-violet-600 text-white font-bold disabled:opacity-40"
            >
              OK
            </button>
            <button
              onClick={() => setShowManual(false)}
              className="w-12 py-3 rounded-2xl bg-white/20 backdrop-blur text-white flex items-center justify-center"
            >
              <X size={18} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowManual(true)}
            className="w-full py-3.5 rounded-2xl bg-white/15 backdrop-blur border border-white/20 text-white font-semibold text-sm flex items-center justify-center gap-2 active:bg-white/25 transition-colors"
          >
            <Keyboard size={18} />
            Saisie manuelle
          </button>
        )}
      </div>

      {/* Scan count */}
      {scanCount > 0 && (
        <div className="absolute top-4 right-24 z-20 safe-top">
          <span className="px-2.5 py-1 rounded-full bg-violet-600 text-white text-[10px] font-bold">
            {scanCount} scan{scanCount > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
