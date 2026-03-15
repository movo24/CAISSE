// ── useScanner ───────────────────────────────────────────────────
// Barcode scanner hook — BarcodeDetector (primary) + html5-qrcode (fallback)
//
// Detection chain:
//  1. BarcodeDetector API (native Chrome/Edge, zero bundle cost)
//     → Uses our <video> element + setInterval detect()
//  2. html5-qrcode (dynamic import, ~50KB gzip, iOS Safari fallback)
//     → Manages its OWN camera + video rendering in a container div
//  3. Manual entry (always available via onManualSubmit)
//
// CRITICAL: On iOS Safari, BarcodeDetector does NOT exist.
// We must detect this BEFORE opening getUserMedia, and go directly
// to html5-qrcode which manages its own camera stream.
// Otherwise: we open a stream, close it, html5-qrcode opens a new
// one in a hidden div → user sees black screen.
//
// Uses refs for all callbacks to avoid stale closure bugs.
// ─────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback, useEffect } from 'react';

export interface ScanResult {
  code: string;
  format: string;
  timestamp: number;
}

interface UseScannerOptions {
  onScan: (result: ScanResult) => void;
  cooldownMs?: number;
  continuous?: boolean;
}

interface UseScannerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  isActive: boolean;
  /** True when using html5-qrcode fallback (iOS) — video element is unused */
  usingFallback: boolean;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  cameraError: string | null;
  torchAvailable: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
  onManualSubmit: (code: string) => void;
  lastScan: ScanResult | null;
  scanCount: number;
}

// ── Audio feedback ──

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
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    osc.stop(audioCtx.currentTime + 0.15);
  } catch {
    /* audio not available */
  }
}

// ── Capability detection ──

function hasBarcodeDetectorAPI(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

function hasMediaDevices(): boolean {
  return !!(
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

// ── Hook ──

export function useScanner({
  onScan,
  cooldownMs = 1500,
  continuous = false,
}: UseScannerOptions): UseScannerReturn {
  const videoRef = useRef<HTMLVideoElement>(null!);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const html5QrRef = useRef<any>(null);
  const cooldownRef = useRef(false);
  const lastCodeRef = useRef<string>('');

  // Store callbacks in refs to avoid stale closures
  const onScanRef = useRef(onScan);
  const continuousRef = useRef(continuous);
  const cooldownMsRef = useRef(cooldownMs);

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { continuousRef.current = continuous; }, [continuous]);
  useEffect(() => { cooldownMsRef.current = cooldownMs; }, [cooldownMs]);

  const [isActive, setIsActive] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [scanCount, setScanCount] = useState(0);

  // ── Core detection handler (uses refs — never stale) ──

  const handleDetection = useCallback((code: string, format: string) => {
    const cleanCode = code.trim().replace(/[^\x20-\x7E]/g, '');
    if (!cleanCode || cleanCode.length < 3) {
      console.warn('[Scanner] Code trop court ou invalide:', JSON.stringify(code));
      return;
    }

    if (cooldownRef.current && cleanCode === lastCodeRef.current) {
      return; // Anti-bounce
    }

    cooldownRef.current = true;
    lastCodeRef.current = cleanCode;
    setTimeout(() => {
      cooldownRef.current = false;
      if (!continuousRef.current) lastCodeRef.current = '';
    }, cooldownMsRef.current);

    const result: ScanResult = { code: cleanCode, format, timestamp: Date.now() };
    console.log('[Scanner] ✓ Detection:', cleanCode, 'format:', format);

    setLastScan(result);
    setScanCount((c) => c + 1);

    playBeep();
    try { if (navigator.vibrate) navigator.vibrate([50]); } catch { /* */ }

    try {
      onScanRef.current(result);
    } catch (err) {
      console.error('[Scanner] onScan error:', err);
    }
  }, []);

  // ── Stop camera ──

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    if (html5QrRef.current) {
      try { html5QrRef.current.stop().catch(() => {}); } catch { /* */ }
      html5QrRef.current = null;
      const container = document.getElementById('html5qr-cam');
      if (container) {
        container.style.cssText = 'display:none;';
        while (container.firstChild) container.removeChild(container.firstChild);
      }
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsActive(false);
    setUsingFallback(false);
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  // ── Start camera ──

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);

    if (!hasMediaDevices()) {
      setCameraError('Camera non disponible. Utilisez la saisie manuelle.');
      return;
    }

    const canUseNativeDetector = hasBarcodeDetectorAPI();
    console.log('[Scanner] BarcodeDetector disponible:', canUseNativeDetector);

    // ══════════════════════════════════════════════════════════════
    // STRATEGY 1: Native BarcodeDetector (Android Chrome, Edge)
    // We open our own getUserMedia stream + <video> element
    // ══════════════════════════════════════════════════════════════
    if (canUseNativeDetector) {
      console.log('[Scanner] Mode natif — getUserMedia + BarcodeDetector');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          console.log('[Scanner] Video playing');
        }

        // Check torch
        const track = stream.getVideoTracks()[0];
        if (track) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch) setTorchAvailable(true);
          } catch { /* */ }
        }

        setIsActive(true);
        setUsingFallback(false);

        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
        });

        // Let camera stabilize
        await new Promise((r) => setTimeout(r, 500));

        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              handleDetection(barcodes[0].rawValue, barcodes[0].format);
            }
          } catch { /* frame error */ }
        }, 200);

        return;
      } catch (e: any) {
        console.error('[Scanner] Native camera error:', e.name, e.message);
        handleCameraError(e);
        return;
      }
    }

    // ══════════════════════════════════════════════════════════════
    // STRATEGY 2: html5-qrcode fallback (iOS Safari, old browsers)
    // html5-qrcode manages its OWN camera + video rendering.
    // We do NOT open getUserMedia — that would conflict.
    // The camera preview is rendered inside #html5qr-cam container.
    // ══════════════════════════════════════════════════════════════
    console.log('[Scanner] Mode fallback — html5-qrcode (iOS)');

    try {
      const { Html5Qrcode } = await import('html5-qrcode');

      // Create or reuse the container for html5-qrcode's own video
      let container = document.getElementById('html5qr-cam');
      if (!container) {
        container = document.createElement('div');
        container.id = 'html5qr-cam';
        document.body.appendChild(container);
      }
      // Full-screen behind our overlay (z-index 0, our overlay is z-50)
      container.style.cssText = 'position:fixed;inset:0;z-index:1;background:black;';

      const html5Qr = new Html5Qrcode('html5qr-cam', false);
      html5QrRef.current = html5Qr;

      await html5Qr.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 140 },
          aspectRatio: 1.7778,
          disableFlip: false,
        } as any,
        (decodedText: string) => {
          console.log('[Scanner] html5-qrcode result:', decodedText);
          handleDetection(decodedText, 'html5-qrcode');
        },
        () => { /* scan miss */ },
      );

      setIsActive(true);
      setUsingFallback(true);
      console.log('[Scanner] html5-qrcode started OK');
    } catch (fallbackErr: any) {
      console.error('[Scanner] html5-qrcode failed:', fallbackErr);

      // If html5-qrcode fails, try opening basic camera for manual entry
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setIsActive(true);
        setUsingFallback(false);
        setCameraError('Detection auto indisponible. Utilisez la saisie manuelle.');
      } catch {
        setCameraError('Camera non disponible. Utilisez la saisie manuelle.');
      }
    }

    function handleCameraError(e: any) {
      if (e.name === 'NotAllowedError') {
        setCameraError("Acces camera refuse. Autorisez dans Reglages > Safari/Chrome.");
      } else if (e.name === 'NotFoundError') {
        setCameraError('Aucune camera trouvee.');
      } else if (e.name === 'NotReadableError') {
        setCameraError('Camera deja utilisee par une autre app.');
      } else if (e.name === 'OverconstrainedError') {
        setCameraError('Camera incompatible.');
      } else {
        setCameraError(`Erreur camera: ${e.message || 'inconnue'}`);
      }
    }
  }, [stopCamera, handleDetection]);

  // ── Torch toggle ──

  const toggleTorch = useCallback(() => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    const newState = !torchOn;
    track
      .applyConstraints({ advanced: [{ torch: newState } as any] })
      .then(() => setTorchOn(newState))
      .catch(() => {});
  }, [torchOn]);

  // ── Manual submit ──

  const onManualSubmit = useCallback((code: string) => {
    const trimmed = code.trim().replace(/[^\x20-\x7E]/g, '');
    if (trimmed.length < 3) return;

    console.log('[Scanner] Saisie manuelle:', trimmed);

    const format =
      trimmed.length === 13 ? 'ean_13' :
      trimmed.length === 8 ? 'ean_8' :
      'manual';

    handleDetection(trimmed, format);
  }, [handleDetection]);

  // ── Cleanup on unmount ──

  useEffect(() => () => stopCamera(), [stopCamera]);

  return {
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
  };
}
