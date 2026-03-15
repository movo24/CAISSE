// ── ScannerOverlay ───────────────────────────────────────────────
// Fullscreen camera scanner with animated viewfinder
//
// Layout:
//  - Header (semi-transparent): back + title + store name
//  - Torch toggle (top-right)
//  - Instruction text + barcode icon
//  - Viewfinder with violet corner markers + animated scan line
//  - Dark overlay around viewfinder
//  - Manual entry button
//  - Green flash on successful scan
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Flashlight, FlashlightOff, ScanBarcode,
  Keyboard, CheckCircle2, X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useScanner, ScanResult } from '../hooks/useScanner';
import { useAuthStore } from '../stores/authStore';

interface ScannerOverlayProps {
  title: string;
  onScan: (result: ScanResult) => void;
  continuous?: boolean;
  /** Extra content below the scanner (e.g., item count badge) */
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

  // Start camera on mount
  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  const handleManualSubmit = () => {
    if (manualCode.trim().length >= 3) {
      onManualSubmit(manualCode.trim());
      setManualCode('');
      if (!continuous) setShowManual(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* ── Video layer ── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* ── Dark overlay with viewfinder cutout ── */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Top overlay */}
        <div className="absolute top-0 left-0 right-0 h-[30%] bg-black/55" />
        {/* Bottom overlay */}
        <div className="absolute bottom-0 left-0 right-0 h-[35%] bg-black/55" />
        {/* Left overlay */}
        <div className="absolute top-[30%] bottom-[35%] left-0 w-[10%] bg-black/55" />
        {/* Right overlay */}
        <div className="absolute top-[30%] bottom-[35%] right-0 w-[10%] bg-black/55" />
      </div>

      {/* ── Green flash on scan ── */}
      {showFlash && (
        <div className="absolute inset-0 bg-emerald-400/25 pointer-events-none scan-flash" />
      )}

      {/* ── Header ── */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-3 pb-2 safe-top">
        <button
          onClick={() => {
            stopCamera();
            navigate(-1);
          }}
          className="w-10 h-10 rounded-xl bg-black/30 backdrop-blur flex items-center justify-center text-white"
        >
          <ArrowLeft size={20} />
        </button>

        <div className="text-center">
          <h1 className="text-white font-bold text-base">{title}</h1>
          {storeInfo?.name && (
            <p className="text-white/60 text-[10px] font-medium">{storeInfo.name}</p>
          )}
        </div>

        {/* Torch toggle */}
        <button
          onClick={toggleTorch}
          disabled={!torchAvailable}
          className={`w-10 h-10 rounded-xl backdrop-blur flex items-center justify-center transition-colors ${
            torchOn
              ? 'bg-yellow-400/80 text-black'
              : 'bg-black/30 text-white disabled:opacity-30'
          }`}
        >
          {torchOn ? <FlashlightOff size={18} /> : <Flashlight size={18} />}
        </button>
      </div>

      {/* ── Instruction ── */}
      <div className="relative z-10 text-center mt-2">
        <p className="text-white/80 text-sm font-medium">
          Placez le code-barres dans le cadre
        </p>
        <ScanBarcode size={24} className="text-white/50 mx-auto mt-2" />
      </div>

      {/* ── Viewfinder ── */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-[10%]">
        <div className="relative w-full" style={{ aspectRatio: '16/7' }}>
          {/* Corner markers - violet, animated */}
          <div className="absolute -top-1 -left-1 w-8 h-8 corner-pulse" style={{ borderTop: '3px solid #7c3aed', borderLeft: '3px solid #7c3aed', borderRadius: '6px 0 0 0' }} />
          <div className="absolute -top-1 -right-1 w-8 h-8 corner-pulse" style={{ borderTop: '3px solid #7c3aed', borderRight: '3px solid #7c3aed', borderRadius: '0 6px 0 0', animationDelay: '0.5s' }} />
          <div className="absolute -bottom-1 -left-1 w-8 h-8 corner-pulse" style={{ borderBottom: '3px solid #7c3aed', borderLeft: '3px solid #7c3aed', borderRadius: '0 0 0 6px', animationDelay: '1s' }} />
          <div className="absolute -bottom-1 -right-1 w-8 h-8 corner-pulse" style={{ borderBottom: '3px solid #7c3aed', borderRight: '3px solid #7c3aed', borderRadius: '0 0 6px 0', animationDelay: '1.5s' }} />

          {/* Animated scan line */}
          <div className="absolute left-2 right-2 h-[2px] bg-gradient-to-r from-transparent via-violet-500/80 to-transparent scan-line" />
        </div>
      </div>

      {/* ── Camera error ── */}
      {cameraError && (
        <div className="relative z-10 mx-6 mb-3 px-4 py-3 rounded-2xl bg-red-500/20 backdrop-blur border border-red-400/30">
          <p className="text-white text-xs font-medium text-center">{cameraError}</p>
          <div className="flex justify-center gap-4 mt-2">
            <button
              onClick={startCamera}
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

      {/* ── Last scan badge ── */}
      {lastScan && (
        <div className="relative z-10 flex justify-center mb-2">
          <div className="px-4 py-2 rounded-xl bg-emerald-500/90 backdrop-blur text-white text-sm font-bold flex items-center gap-2 shadow-lg">
            <CheckCircle2 size={16} />
            {lastScan.code}
          </div>
        </div>
      )}

      {/* ── Bottom content (item count, etc.) ── */}
      {bottomContent && (
        <div className="relative z-10 px-4 mb-2">
          {bottomContent}
        </div>
      )}

      {/* ── Manual entry button / input ── */}
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
              className="flex-1 px-4 py-3 rounded-2xl bg-white text-mobile-text font-mono font-bold text-center text-sm focus:outline-none focus:ring-2 focus:ring-mobile-accent"
            />
            <button
              onClick={handleManualSubmit}
              disabled={manualCode.trim().length < 3}
              className="px-5 py-3 rounded-2xl bg-mobile-accent text-white font-bold disabled:opacity-40"
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
            className="w-full py-3.5 rounded-2xl bg-white/15 backdrop-blur border border-white/20 text-white font-semibold text-sm flex items-center justify-center gap-2"
          >
            <Keyboard size={18} />
            Saisie manuelle
          </button>
        )}
      </div>

      {/* ── Scan count badge ── */}
      {scanCount > 0 && (
        <div className="absolute top-4 right-16 z-20 safe-top">
          <span className="px-2.5 py-1 rounded-full bg-mobile-accent text-white text-[10px] font-bold">
            {scanCount} scan{scanCount > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
