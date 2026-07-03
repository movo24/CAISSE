/**
 * useDeviceProfile — Platform detection & responsive breakpoints
 *
 * Detects the running platform (iPad, Windows tablet, desktop) and
 * provides responsive helpers for adaptive UI rendering.
 *
 * Breakpoints:
 *   - compact:  <= 1024px  (iPad 10.2", iPad Air 10.9")
 *   - standard: 1025-1439px (iPad Pro 12.9", small laptops)
 *   - wide:     >= 1440px  (desktop monitors 15-22")
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

/* ── Types ── */

export type DevicePlatform = 'ipad' | 'android_tablet' | 'windows' | 'mac' | 'linux' | 'unknown';
export type InputMode = 'touch' | 'mouse' | 'hybrid';
export type ScreenClass = 'compact' | 'standard' | 'wide';

export interface DeviceProfile {
  /** Detected platform */
  platform: DevicePlatform;
  /** Primary input mode */
  inputMode: InputMode;
  /** Screen size class */
  screenClass: ScreenClass;
  /** True if touch is available (iPad, tablets) */
  isTouch: boolean;
  /** True if running on iPad/iPadOS */
  isIPad: boolean;
  /** True if running on Windows */
  isWindows: boolean;
  /** True if running inside Electron */
  isElectron: boolean;
  /** True if running inside Capacitor (iPad native) */
  isCapacitor: boolean;
  /** True if PWA/standalone mode */
  isPWA: boolean;
  /** Viewport width in px */
  viewportWidth: number;
  /** Viewport height in px */
  viewportHeight: number;
  /** Device pixel ratio */
  pixelRatio: number;
  /** Recommended button min-height for touch targets (px) */
  touchTargetSize: number;
  /** True if compact mode (iPad portrait, small screens) */
  isCompact: boolean;
  /** True if wide mode (desktop monitors) */
  isWide: boolean;
  /** True if camera available (for barcode scanning) */
  hasCamera: boolean;
  /** True if landscape orientation */
  isLandscape: boolean;
}

/* ── Constants ── */

const BREAKPOINT_COMPACT = 1024;
const BREAKPOINT_WIDE = 1440;

/* ── Detection helpers ── */

function detectPlatform(): DevicePlatform {
  const ua = navigator.userAgent;

  // iPadOS 13+ reports as Mac, detect via touch + Mac
  if (/iPad/i.test(ua)) return 'ipad';
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ipad';

  // Android tablet (not phone — check screen size)
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'android_tablet';

  // Windows
  if (/Windows/i.test(ua)) return 'windows';

  // Mac (real Mac, not iPad masquerading)
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';

  // Linux
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';

  return 'unknown';
}

function detectInputMode(): InputMode {
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const hasPointer = window.matchMedia('(pointer: fine)').matches;

  if (hasTouch && hasPointer) return 'hybrid';
  if (hasTouch) return 'touch';
  return 'mouse';
}

function detectIsElectron(): boolean {
  return typeof window !== 'undefined' &&
    (('electronAPI' in window) ||
     /Electron/i.test(navigator.userAgent) ||
     (typeof process !== 'undefined' && process.versions?.electron !== undefined));
}

function detectIsPWA(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;
}

/** Exporté pour test (POS-019) — pur. */
export function getScreenClass(width: number): ScreenClass {
  if (width <= BREAKPOINT_COMPACT) return 'compact';
  if (width >= BREAKPOINT_WIDE) return 'wide';
  return 'standard';
}

/* ── Hook ── */

export function useDeviceProfile(): DeviceProfile {
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const [hasCamera, setHasCamera] = useState(false);

  // Check camera availability
  useEffect(() => {
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        setHasCamera(devices.some(d => d.kind === 'videoinput'));
      }).catch(() => setHasCamera(false));
    }
  }, []);

  // Resize listener with debounce
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        setViewportWidth(window.innerWidth);
        setViewportHeight(window.innerHeight);
      }, 100);
    };
    window.addEventListener('resize', handleResize);
    // Also listen to orientation changes (iPad)
    window.addEventListener('orientationchange', handleResize);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const profile = useMemo<DeviceProfile>(() => {
    const platform = detectPlatform();
    const inputMode = detectInputMode();
    const screenClass = getScreenClass(viewportWidth);
    const isTouch = inputMode === 'touch' || inputMode === 'hybrid';
    const isIPad = platform === 'ipad';
    const isWindows = platform === 'windows';

    return {
      platform,
      inputMode,
      screenClass,
      isTouch,
      isIPad,
      isWindows,
      isElectron: detectIsElectron(),
      isCapacitor: typeof (window as any).Capacitor !== 'undefined',
      isPWA: detectIsPWA(),
      viewportWidth,
      viewportHeight,
      pixelRatio: window.devicePixelRatio || 1,
      // Apple HIG: 44pt minimum, Material: 48dp minimum
      touchTargetSize: isTouch ? 48 : 32,
      isCompact: screenClass === 'compact',
      isWide: screenClass === 'wide',
      hasCamera,
      isLandscape: viewportWidth > viewportHeight,
    };
  }, [viewportWidth, viewportHeight, hasCamera]);

  return profile;
}

/* ── Utility: CSS class builder based on profile ── */

export function platformClasses(profile: DeviceProfile): string {
  const classes: string[] = [];
  classes.push(`platform-${profile.platform}`);
  classes.push(`input-${profile.inputMode}`);
  classes.push(`screen-${profile.screenClass}`);
  if (profile.isTouch) classes.push('is-touch');
  if (profile.isElectron) classes.push('is-electron');
  if (profile.isPWA) classes.push('is-pwa');
  if (profile.isLandscape) classes.push('is-landscape');
  return classes.join(' ');
}

/* ── Context for deep tree access ── */

import { createContext, useContext } from 'react';

export const DeviceProfileContext = createContext<DeviceProfile | null>(null);

export function useDeviceProfileContext(): DeviceProfile {
  const ctx = useContext(DeviceProfileContext);
  if (!ctx) throw new Error('useDeviceProfileContext must be used within DeviceProfileProvider');
  return ctx;
}
