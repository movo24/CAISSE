// ── useScanner ───────────────────────────────────────────────────
// Barcode scanner hook
//
// Detection engines:
//  1. Native BarcodeDetector API (Chrome/Edge/Android 83+)
//     → getUserMedia + setInterval detect() on our <video>
//  2. ZXing (@zxing/browser) — works on ALL browsers including iOS Safari
//     → BrowserMultiFormatReader.decodeFromConstraints()
//     → ZXing opens its own camera stream and renders in our <video>
//     → Much more reliable than html5-qrcode on iOS
//  3. Manual entry always available
//
// Debug: exposes debugLog[] for visible on-screen diagnostics
// ─────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback, useEffect } from 'react';
import { cleanScanCode, shouldAcceptScan } from '../lib/scan-gate';

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
  usingFallback: boolean;
  startCamera: () => Promise<void>;
  stopCamera: () => Promise<void>;
  cameraError: string | null;
  torchAvailable: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
  onManualSubmit: (code: string) => void;
  lastScan: ScanResult | null;
  scanCount: number;
  debugLog: string[];
}

// ── Audio feedback ──

let audioCtx: AudioContext | null = null;
function playBeep() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    if (audioCtx.state !== 'running') return;
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
  } catch { /* */ }
}

if (typeof window !== 'undefined') {
  const initAudio = () => {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    window.removeEventListener('touchstart', initAudio);
    window.removeEventListener('click', initAudio);
  };
  window.addEventListener('touchstart', initAudio, { once: true });
  window.addEventListener('click', initAudio, { once: true });
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
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  const cooldownRef = useRef(false);
  const lastCodeRef = useRef<string>('');
  const mountedRef = useRef(true);

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
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const addDebug = useCallback((msg: string) => {
    console.log('[Scanner]', msg);
    setDebugLog((prev) => [...prev.slice(-14), `${new Date().toLocaleTimeString('fr-FR')}: ${msg}`]);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Core detection handler ──

  const handleDetection = useCallback((code: string, format: string) => {
    // P355 — cœur extrait en pur (lib/scan-gate.ts, testé) ; comportement identique.
    const cleanCode = cleanScanCode(code);
    if (!cleanCode) return;

    if (!shouldAcceptScan(cleanCode, {
      cooldownActive: cooldownRef.current,
      continuous: continuousRef.current,
      lastCode: lastCodeRef.current,
    })) return;

    cooldownRef.current = true;
    lastCodeRef.current = cleanCode;
    setTimeout(() => {
      cooldownRef.current = false;
      if (!continuousRef.current) lastCodeRef.current = '';
    }, cooldownMsRef.current);

    const result: ScanResult = { code: cleanCode, format, timestamp: Date.now() };
    addDebug(`✓ DETECTE: ${cleanCode} (${format})`);

    if (mountedRef.current) {
      setLastScan(result);
      setScanCount((c) => c + 1);
    }

    playBeep();
    try { if (navigator.vibrate) navigator.vibrate([50]); } catch { /* */ }

    try {
      onScanRef.current(result);
    } catch (err: any) {
      addDebug(`onScan erreur: ${err.message}`);
    }
  }, [addDebug]);

  function handleCameraError(e: any) {
    if (!mountedRef.current) return;
    const msg = e.name === 'NotAllowedError'
      ? 'Acces camera refuse. Autorisez dans Reglages.'
      : e.name === 'NotFoundError'
      ? 'Aucune camera trouvee.'
      : e.name === 'NotReadableError'
      ? 'Camera utilisee par autre app.'
      : `Erreur: ${e.message || e.name || 'inconnue'}`;
    setCameraError(msg);
    addDebug(`ERREUR: ${msg}`);
  }

  // ── Stop camera ──

  const stopCamera = useCallback(async () => {
    // Stop native BarcodeDetector interval
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    // Stop ZXing continuous scanning
    if (zxingControlsRef.current) {
      try { zxingControlsRef.current.stop(); } catch { /* */ }
      zxingControlsRef.current = null;
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Clean video element
    if (videoRef.current) videoRef.current.srcObject = null;

    if (mountedRef.current) {
      setIsActive(false);
      setUsingFallback(false);
      setTorchOn(false);
      setTorchAvailable(false);
    }
  }, []);

  // ── Start camera ──

  const startCamera = useCallback(async () => {
    await stopCamera();
    if (mountedRef.current) setCameraError(null);

    if (!hasMediaDevices()) {
      setCameraError('Camera non disponible.');
      return;
    }

    const canUseNative = hasBarcodeDetectorAPI();
    addDebug(`BarcodeDetector: ${canUseNative ? 'OUI' : 'NON'}`);

    // ═══════════════════════════════════════════════════════
    // STRATEGY 1: Native BarcodeDetector (Android Chrome)
    // ═══════════════════════════════════════════════════════
    if (canUseNative) {
      addDebug('Mode natif (BarcodeDetector)');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (!mountedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try { await videoRef.current.play(); } catch { /* */ }
        }

        const track = stream.getVideoTracks()[0];
        if (track) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch && mountedRef.current) setTorchAvailable(true);
          } catch { /* */ }
          addDebug(`Camera: ${track.label}`);
        }

        if (mountedRef.current) {
          setIsActive(true);
          setUsingFallback(false);
        }

        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
        });

        await new Promise((r) => setTimeout(r, 500));
        if (!mountedRef.current || !streamRef.current) return;

        addDebug('Detection native active (200ms interval)');
        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          if (!streamRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              handleDetection(barcodes[0].rawValue, barcodes[0].format);
            }
          } catch { /* */ }
        }, 200);

        return;
      } catch (e: any) {
        addDebug(`Natif echoue: ${e.name} ${e.message}`);
        handleCameraError(e);
        return;
      }
    }

    // ═══════════════════════════════════════════════════════
    // STRATEGY 2: ZXing (@zxing/browser) — iOS Safari + all
    // ZXing opens getUserMedia itself and renders in our
    // <video> element. It handles its own canvas internally.
    // Much more reliable than html5-qrcode on iOS.
    // ═══════════════════════════════════════════════════════
    addDebug('Mode ZXing (@zxing/browser)');

    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');

      if (!mountedRef.current) return;

      // Configure hints for barcode formats
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.QR_CODE,
      ]);
      // Try harder to find barcodes
      hints.set(DecodeHintType.TRY_HARDER, true);

      addDebug('Formats: EAN-13/8, UPC-A/E, Code128/39, QR');

      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 150, // Scan every 150ms
        delayBetweenScanSuccess: 1000,  // Wait 1s between successful scans
      });

      addDebug('ZXing reader cree, demarrage camera...');

      // decodeFromConstraints: opens camera, renders in videoRef, and
      // continuously calls our callback with decode results.
      // It returns IScannerControls with a stop() method.
      const controls = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        videoRef.current, // ZXing renders camera into OUR video element
        (result: any, error: any) => {
          if (result) {
            const text = result.getText();
            const format = BarcodeFormat[result.getBarcodeFormat()] || 'unknown';
            addDebug(`ZXing decode: "${text}" (${format})`);
            handleDetection(text, format);
          }
          // error is normal when no barcode is found — don't log unless it's real
          if (error && error.name !== 'NotFoundException') {
            addDebug(`ZXing err: ${error.name}`);
          }
        },
      );

      zxingControlsRef.current = controls;

      // Grab the stream for torch support
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (track) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch && mountedRef.current) setTorchAvailable(true);
          } catch { /* */ }
          addDebug(`Camera: ${track.label}`);
        }
      }

      if (mountedRef.current) {
        setIsActive(true);
        setUsingFallback(true);
      }
      addDebug('ZXing DEMARRE OK — scan continu actif');

    } catch (err: any) {
      addDebug(`ZXing ECHOUE: ${err.message || err}`);

      // Last resort: open camera for manual entry only
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (!mountedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try { await videoRef.current.play(); } catch { /* */ }
        }
        if (mountedRef.current) {
          setIsActive(true);
          setUsingFallback(false);
          setCameraError('Detection auto indisponible. Utilisez saisie manuelle.');
        }
      } catch (camErr: any) {
        handleCameraError(camErr);
      }
    }
  }, [stopCamera, handleDetection, addDebug]);

  // ── Torch toggle ──

  const toggleTorch = useCallback(() => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    const newState = !torchOn;
    track
      .applyConstraints({ advanced: [{ torch: newState } as any] })
      .then(() => { if (mountedRef.current) setTorchOn(newState); })
      .catch(() => {});
  }, [torchOn]);

  // ── Manual submit ──

  const onManualSubmit = useCallback((code: string) => {
    const trimmed = code.trim().replace(/[^\x20-\x7E]/g, '');
    if (trimmed.length < 3) return;
    addDebug(`Saisie manuelle: ${trimmed}`);
    const format =
      trimmed.length === 13 ? 'ean_13' :
      trimmed.length === 8 ? 'ean_8' :
      'manual';
    handleDetection(trimmed, format);
  }, [handleDetection, addDebug]);

  // ── Cleanup ──

  useEffect(() => () => { stopCamera(); }, [stopCamera]);

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
    debugLog,
  };
}
