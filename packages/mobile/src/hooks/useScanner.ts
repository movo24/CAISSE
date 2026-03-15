// ── useScanner ───────────────────────────────────────────────────
// Barcode scanner hook — BarcodeDetector (primary) + html5-qrcode (fallback)
//
// Detection chain:
//  1. BarcodeDetector API (native Chrome/Edge, zero bundle cost)
//  2. html5-qrcode (dynamic import, ~50KB gzip, iOS Safari fallback)
//  3. Manual entry (always available via onManualSubmit)
//
// Features: anti-bounce 1.5s, vibration, beep, torch toggle
//
// IMPORTANT: Uses refs for all callbacks to avoid stale closure bugs.
// The setInterval inside startCamera must always call the LATEST
// version of onScan, not a stale captured closure.
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

  // ─── CRITICAL: Store callbacks in refs to avoid stale closures ───
  // The setInterval inside startCamera runs for the lifetime of the camera.
  // It must always call the LATEST onScan, not the one captured at startCamera() time.
  const onScanRef = useRef(onScan);
  const continuousRef = useRef(continuous);
  const cooldownMsRef = useRef(cooldownMs);

  // Keep refs in sync with latest props
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { continuousRef.current = continuous; }, [continuous]);
  useEffect(() => { cooldownMsRef.current = cooldownMs; }, [cooldownMs]);

  const [isActive, setIsActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [scanCount, setScanCount] = useState(0);

  // ── Core detection handler (uses refs — never stale) ──

  const handleDetection = useCallback((code: string, format: string) => {
    // Normalize: trim whitespace, remove invisible chars
    const cleanCode = code.trim().replace(/[^\x20-\x7E]/g, '');
    if (!cleanCode || cleanCode.length < 3) {
      console.warn('[Scanner] Code trop court ou invalide:', JSON.stringify(code));
      return;
    }

    // Anti-bounce: ignore same code within cooldown
    if (cooldownRef.current && cleanCode === lastCodeRef.current) {
      console.log('[Scanner] Anti-bounce: meme code ignore');
      return;
    }

    cooldownRef.current = true;
    lastCodeRef.current = cleanCode;
    setTimeout(() => {
      cooldownRef.current = false;
      if (!continuousRef.current) lastCodeRef.current = '';
    }, cooldownMsRef.current);

    const result: ScanResult = { code: cleanCode, format, timestamp: Date.now() };

    console.log('[Scanner] Detection:', cleanCode, 'format:', format);

    setLastScan(result);
    setScanCount((c) => c + 1);

    // Haptic + audio feedback — BEFORE calling onScan (instant feedback)
    playBeep();
    try { if (navigator.vibrate) navigator.vibrate([50]); } catch { /* no vibration API */ }

    // Call the LATEST onScan via ref (not a stale closure)
    try {
      onScanRef.current(result);
    } catch (err) {
      console.error('[Scanner] onScan callback error:', err);
    }
  }, []); // Empty deps — uses refs, never stale

  // ── Stop camera ──

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    if (html5QrRef.current) {
      try { html5QrRef.current.stop().catch(() => {}); } catch { /* ignore */ }
      html5QrRef.current = null;
      // Clean up the html5-qrcode container
      const container = document.getElementById('html5-qrcode-scanner');
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
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  // ── Start camera ──

  const startCamera = useCallback(async () => {
    // Clean up any existing camera first
    stopCamera();
    setCameraError(null);

    if (!hasMediaDevices()) {
      setCameraError('Camera non disponible. Utilisez la saisie manuelle.');
      return;
    }

    console.log('[Scanner] Demande acces camera...');

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
        console.log('[Scanner] Camera active, video playing');
      }

      // Check torch availability
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          const caps = track.getCapabilities?.() as any;
          if (caps?.torch) {
            setTorchAvailable(true);
            console.log('[Scanner] Torch disponible');
          }
        } catch { /* getCapabilities not supported */ }
      }

      setIsActive(true);

      // ── Strategy 1: BarcodeDetector API (native Chrome/Edge/Android) ──
      if (hasBarcodeDetectorAPI()) {
        console.log('[Scanner] Using BarcodeDetector API (native)');

        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
        });

        // Wait a moment for camera to stabilize before starting detection
        await new Promise((r) => setTimeout(r, 500));

        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              const bc = barcodes[0];
              console.log('[Scanner] BarcodeDetector result:', bc.rawValue, bc.format);
              handleDetection(bc.rawValue, bc.format);
            }
          } catch {
            /* frame decode error — normal, ignore */
          }
        }, 200); // 200ms = 5 scans/sec (stable on mobile)

        return;
      }

      // ── Strategy 2: html5-qrcode fallback (iOS Safari) ──
      // IMPORTANT: html5-qrcode manages its OWN camera stream.
      // We must STOP our stream first to avoid double-camera conflicts on iOS.
      console.log('[Scanner] BarcodeDetector unavailable, trying html5-qrcode fallback...');

      // Release our camera stream — html5-qrcode will open its own
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      try {
        const { Html5Qrcode } = await import('html5-qrcode');

        // html5-qrcode renders into a visible container (its own video feed)
        let container = document.getElementById('html5-qrcode-scanner');
        if (!container) {
          container = document.createElement('div');
          container.id = 'html5-qrcode-scanner';
          document.body.appendChild(container);
        }
        // Position it behind our overlay — full-screen camera
        container.style.cssText = 'position:fixed;inset:0;z-index:0;background:black;';

        const html5Qr = new Html5Qrcode('html5-qrcode-scanner', /* verbose */ false);
        html5QrRef.current = html5Qr;

        await html5Qr.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 280, height: 150 },
            aspectRatio: 1.7778,
          } as any,
          (decodedText: string) => {
            console.log('[Scanner] html5-qrcode result:', decodedText);
            handleDetection(decodedText, 'html5-qrcode');
          },
          () => { /* scan frame miss — normal */ },
        );

        console.log('[Scanner] html5-qrcode started successfully');
      } catch (fallbackErr: any) {
        console.error('[Scanner] html5-qrcode failed:', fallbackErr);
        setCameraError('Scanner indisponible sur ce navigateur. Utilisez la saisie manuelle.');
      }
    } catch (e: any) {
      console.error('[Scanner] Camera error:', e.name, e.message);

      if (e.name === 'NotAllowedError') {
        setCameraError("Acces camera refuse. Autorisez dans Reglages > Safari/Chrome.");
      } else if (e.name === 'NotFoundError') {
        setCameraError('Aucune camera trouvee.');
      } else if (e.name === 'NotReadableError') {
        setCameraError('Camera deja utilisee par une autre app.');
      } else if (e.name === 'OverconstrainedError') {
        setCameraError('Camera incompatible. Essayez avec un autre appareil.');
      } else {
        setCameraError(`Erreur camera: ${e.message || 'inconnue'}`);
      }
    }
  }, [stopCamera, handleDetection]); // handleDetection is stable (empty deps + refs)

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

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return {
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
  };
}
