// ── useScanner ───────────────────────────────────────────────────
// Barcode scanner hook — BarcodeDetector (primary) + html5-qrcode (fallback)
//
// Detection chain:
//  1. BarcodeDetector API (native Chrome/Edge, zero bundle cost)
//  2. html5-qrcode (dynamic import, ~50KB gzip, iOS Safari fallback)
//  3. Manual entry (always available via onManualSubmit)
//
// Features: anti-bounce 1.5s, vibration, beep, torch toggle
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
  // Camera
  videoRef: React.RefObject<HTMLVideoElement>;
  isActive: boolean;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  cameraError: string | null;

  // Torch
  torchAvailable: boolean;
  torchOn: boolean;
  toggleTorch: () => void;

  // Manual
  onManualSubmit: (code: string) => void;

  // State
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
    gain.gain.value = 0.12;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
    osc.stop(audioCtx.currentTime + 0.12);
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

  const [isActive, setIsActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [scanCount, setScanCount] = useState(0);

  // ── Core detection handler ──

  const handleDetection = useCallback(
    (code: string, format: string) => {
      // Anti-bounce: ignore same code within cooldown
      if (cooldownRef.current && code === lastCodeRef.current) return;

      cooldownRef.current = true;
      lastCodeRef.current = code;
      setTimeout(() => {
        cooldownRef.current = false;
        if (!continuous) lastCodeRef.current = '';
      }, cooldownMs);

      const result: ScanResult = { code, format, timestamp: Date.now() };
      setLastScan(result);
      setScanCount((c) => c + 1);

      // Haptic + audio feedback
      playBeep();
      if (navigator.vibrate) navigator.vibrate(50);

      onScan(result);
    },
    [onScan, cooldownMs, continuous],
  );

  // ── Start camera ──

  const startCamera = useCallback(async () => {
    setCameraError(null);

    if (!hasMediaDevices()) {
      setCameraError('Camera non disponible. Utilisez la saisie manuelle.');
      return;
    }

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
      }

      // Check torch availability
      const track = stream.getVideoTracks()[0];
      if (track) {
        const caps = track.getCapabilities?.() as any;
        if (caps?.torch) {
          setTorchAvailable(true);
        }
      }

      setIsActive(true);

      // ── Strategy 1: BarcodeDetector API ──
      if (hasBarcodeDetectorAPI()) {
        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
        });

        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              handleDetection(barcodes[0].rawValue, barcodes[0].format);
            }
          } catch {
            /* frame decode error, ignore */
          }
        }, 150);

        return;
      }

      // ── Strategy 2: html5-qrcode fallback (iOS Safari) ──
      try {
        const { Html5Qrcode } = await import('html5-qrcode');

        // html5-qrcode needs a container element
        let container = document.getElementById('html5-qrcode-scanner');
        if (!container) {
          container = document.createElement('div');
          container.id = 'html5-qrcode-scanner';
          container.style.display = 'none';
          document.body.appendChild(container);
        }

        const html5Qr = new Html5Qrcode('html5-qrcode-scanner');
        html5QrRef.current = html5Qr;

        await html5Qr.start(
          { facingMode: 'environment' },
          {
            fps: 8,
            qrbox: { width: 280, height: 150 },
          } as any,
          (decodedText: string) => {
            handleDetection(decodedText, 'html5-qrcode');
          },
          () => {
            /* scan error, ignore */
          },
        );
      } catch (fallbackErr: any) {
        setCameraError(
          'Scanner indisponible sur ce navigateur. Utilisez la saisie manuelle.',
        );
      }
    } catch (e: any) {
      if (e.name === 'NotAllowedError') {
        setCameraError("Acces camera refuse. Autorisez dans Reglages > Safari/Chrome.");
      } else if (e.name === 'NotFoundError') {
        setCameraError('Aucune camera trouvee.');
      } else if (e.name === 'NotReadableError') {
        setCameraError('Camera deja utilisee par une autre app.');
      } else {
        setCameraError(e.message || 'Erreur camera');
      }
    }
  }, [handleDetection]);

  // ── Stop camera ──

  const stopCamera = useCallback(() => {
    // Stop BarcodeDetector interval
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    // Stop html5-qrcode
    if (html5QrRef.current) {
      html5QrRef.current.stop().catch(() => {});
      html5QrRef.current = null;
    }

    // Stop media stream
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

  const onManualSubmit = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (trimmed.length < 3) return;
      const format =
        trimmed.length === 13
          ? 'ean_13'
          : trimmed.length === 8
            ? 'ean_8'
            : 'manual';
      handleDetection(trimmed, format);
    },
    [handleDetection],
  );

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
