// ── useScanner ───────────────────────────────────────────────────
// Barcode scanner hook
//
// Strategy:
//  1. BarcodeDetector API (native Chrome/Edge/Android)
//     → Uses our <video> element + setInterval detect()
//  2. html5-qrcode fallback (iOS Safari, older browsers)
//     → html5-qrcode manages its own camera + video + canvas
//     → We do NOT open getUserMedia — html5-qrcode does it
//     → We do NOT fight its DOM — we let it render freely
//  3. Manual entry always available
//
// Debug: exposes debugLog[] for visible on-screen diagnostics
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
  const html5QrRef = useRef<any>(null);
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
    setDebugLog((prev) => [...prev.slice(-9), `${new Date().toLocaleTimeString('fr-FR')}: ${msg}`]);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Core detection handler ──

  const handleDetection = useCallback((code: string, format: string) => {
    const cleanCode = code.trim().replace(/[^\x20-\x7E]/g, '');
    if (!cleanCode || cleanCode.length < 3) return;

    if (cooldownRef.current) {
      if (!continuousRef.current || cleanCode === lastCodeRef.current) return;
    }

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
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    if (html5QrRef.current) {
      const qr = html5QrRef.current;
      html5QrRef.current = null;
      try { await qr.stop(); } catch { /* */ }
    }

    // Clean up html5-qrcode container
    const container = document.getElementById('html5qr-cam');
    if (container) {
      container.style.display = 'none';
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

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

    // ═══ STRATEGY 1: Native BarcodeDetector ═══
    if (canUseNative) {
      addDebug('Mode natif (getUserMedia + BarcodeDetector)');
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

        addDebug('Detection native active');
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

    // ═══ STRATEGY 2: html5-qrcode (iOS Safari) ═══
    // Let html5-qrcode handle EVERYTHING — camera, video, canvas, detection.
    // We only provide a container div and callbacks.
    addDebug('Mode html5-qrcode (iOS)');

    try {
      const html5QrcodeModule = await import('html5-qrcode');
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = html5QrcodeModule;

      if (!mountedRef.current) return;

      // Create container — html5-qrcode will fill it with video + canvas
      let container = document.getElementById('html5qr-cam');
      if (!container) {
        container = document.createElement('div');
        container.id = 'html5qr-cam';
        document.body.appendChild(container);
      }
      // Position full-screen, behind our UI (z-index 50)
      container.style.cssText = 'position:fixed;inset:0;z-index:0;background:#000;display:block;';

      addDebug('Container cree, init html5Qrcode...');

      const formatsToSupport = [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.QR_CODE,
      ];

      addDebug(`Formats: ${formatsToSupport.join(',')}`);

      const html5Qr = new Html5Qrcode('html5qr-cam', {
        formatsToSupport,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: false, // Force ZXing on iOS — no native BarcodeDetector
        },
        verbose: true, // Temporary — helps diagnose on device
      } as any);

      html5QrRef.current = html5Qr;

      addDebug('html5Qrcode instancie, demarrage camera...');

      // Calculate qrbox based on screen size — html5-qrcode NEEDS this
      // for proper scanning region setup
      const screenW = window.innerWidth;
      const screenH = window.innerHeight;
      const qrboxW = Math.floor(screenW * 0.8);
      const qrboxH = Math.floor(qrboxW * 0.4); // Wide rectangle for barcodes

      addDebug(`qrbox: ${qrboxW}x${qrboxH} (ecran: ${screenW}x${screenH})`);

      await html5Qr.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: qrboxW, height: qrboxH },
          aspectRatio: screenW / screenH,
          disableFlip: false,
        },
        (decodedText: string) => {
          addDebug(`DECODE: "${decodedText}"`);
          handleDetection(decodedText, 'html5-qrcode');
        },
        undefined, // Don't pass error callback — reduces noise
      );

      if (mountedRef.current) {
        setIsActive(true);
        setUsingFallback(true);
      }
      addDebug('html5-qrcode DEMARRE OK — detection active');
    } catch (err: any) {
      addDebug(`html5-qrcode ECHOUE: ${err.message || err}`);

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
