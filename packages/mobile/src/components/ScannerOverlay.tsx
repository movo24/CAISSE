// ── ScannerOverlay ───────────────────────────────────────────────
// Fullscreen camera scanner with animated viewfinder
//
// Two rendering modes:
// A) Native (Android Chrome): our <video> shows camera + BarcodeDetector
// B) Fallback (iOS Safari): html5-qrcode renders its own video in
//    #html5qr-cam div. Our <video> is hidden. The overlay UI sits
//    on top of html5-qrcode's camera view.
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft, Flashlight, FlashlightOff, ScanBarcode,
  Keyboard, CheckCircle2, X, Loader2,
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
  const cameraStarted = useRef(false);

  const handleScan = useCallback(
    (result: ScanResult) => {
      setShowFlash(true);
      setTimeout(() => setShowFlash(false), 300);
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
  } = useScanner({ onScan: handleScan, continuous });

  // Start camera ONCE on mount
  useEffect(() => {
    if (!cameraStarted.current) {
      cameraStarted.current = true;
      startCamera();
    }
    return () => stopCamera();
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
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/*
        Video layer — ONLY shown when using native BarcodeDetector.
        When using html5-qrcode fallback, the camera video is rendered
        by html5-qrcode in #html5qr-cam (z-index 1, behind this z-50 overlay).
      */}
      {!usingFallback && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/*
        When using fallback mode, make overlay background transparent
        so html5-qrcode's camera (rendered behind in #html5qr-cam) shows through.
      */}
      {usingFallback && (
        <div className="absolute inset-0 bg-transparent" />
      )}

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
          onClick={() => {
            stopCamera();
            navigate(-1);
          }}
          className="w-10 h-10 rounded-xl bg-black/40 backdrop-blur flex items-center justify-center text-white active:scale-95 transition-transform"
        >
          <ArrowLeft size={20} />
        </button>

        <div className="text-center">
          <h1 className="text-white font-bold text-base">{title}</h1>
          {storeInfo?.name && (
            <p className="text-white/60 text-[10px] font-medium">{storeInfo.name}</p>
          )}
        </div>

        {/* Torch (only native mode) */}
        {!usingFallback ? (
          <button
            onClick={toggleTorch}
            disabled={!torchAvailable}
            className={`w-10 h-10 rounded-xl backdrop-blur flex items-center justify-center transition-colors ${
              torchOn
                ? 'bg-yellow-400/80 text-black'
                : 'bg-black/40 text-white disabled:opacity-30'
            }`}
          >
            {torchOn ? <FlashlightOff size={18} /> : <Flashlight size={18} />}
          </button>
        ) : (
          <div className="w-10" /> // Spacer
        )}
      </div>

      {/* Camera loading */}
      {!isActive && !cameraError && (
        <div className="relative z-10 flex items-center justify-center mt-8">
          <div className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-black/50 backdrop-blur text-white text-sm">
            <Loader2 size={16} className="animate-spin" />
            Demarrage camera...
          </div>
        </div>
      )}

      {/* Instruction */}
      {isActive && (
        <div className="relative z-10 text-center mt-2">
          <p className="text-white/80 text-sm font-medium">
            Placez le code-barres dans le cadre
          </p>
          <ScanBarcode size={24} className="text-white/50 mx-auto mt-2" />
        </div>
      )}

      {/* Viewfinder */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-[8%]">
        <div className="relative w-full" style={{ aspectRatio: '16/7' }}>
          {/* Corner markers */}
          <div className="absolute -top-1 -left-1 w-8 h-8 corner-pulse" style={{ borderTop: '3px solid #7c3aed', borderLeft: '3px solid #7c3aed', borderRadius: '6px 0 0 0' }} />
          <div className="absolute -top-1 -right-1 w-8 h-8 corner-pulse" style={{ borderTop: '3px solid #7c3aed', borderRight: '3px solid #7c3aed', borderRadius: '0 6px 0 0', animationDelay: '0.5s' }} />
          <div className="absolute -bottom-1 -left-1 w-8 h-8 corner-pulse" style={{ borderBottom: '3px solid #7c3aed', borderLeft: '3px solid #7c3aed', borderRadius: '0 0 0 6px', animationDelay: '1s' }} />
          <div className="absolute -bottom-1 -right-1 w-8 h-8 corner-pulse" style={{ borderBottom: '3px solid #7c3aed', borderRight: '3px solid #7c3aed', borderRadius: '0 0 6px 0', animationDelay: '1.5s' }} />

          {/* Scan line */}
          <div className="absolute left-2 right-2 h-[2px] bg-gradient-to-r from-transparent via-violet-500/80 to-transparent scan-line" />
        </div>
      </div>

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
        <div className="relative z-10 flex flex-col items-center gap-1 mb-2 animate-slide-up">
          <div className="px-4 py-2 rounded-xl bg-emerald-500/90 backdrop-blur text-white text-sm font-bold flex items-center gap-2 shadow-lg">
            <CheckCircle2 size={16} />
            Code lu : {lastScan.code}
          </div>
          <span className="text-white/40 text-[9px] font-mono">
            format: {lastScan.format} | {new Date(lastScan.timestamp).toLocaleTimeString('fr-FR')}
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
          <div className="flex gap-2 animate-slide-up">
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
        <div className="absolute top-4 right-16 z-20 safe-top">
          <span className="px-2.5 py-1 rounded-full bg-violet-600 text-white text-[10px] font-bold">
            {scanCount} scan{scanCount > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
