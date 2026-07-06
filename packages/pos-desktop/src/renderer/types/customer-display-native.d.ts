/**
 * Ambient types for the Electron-exposed customer-display native bridge.
 * Present only in the desktop build; guard on `window.customerDisplayNative`
 * before use so the web build degrades gracefully.
 */

export interface NativeDisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  resolution: string;
  scaleFactor: number;
  isPrimary: boolean;
}

export interface NativeDisplayStatus {
  available: true;
  enabled: boolean;
  windowOpen: boolean;
  screenId: number | null;
  resolution: string | null;
  fullscreen: boolean;
  kiosk: boolean;
  displayCount: number;
  displays: NativeDisplayInfo[];
  selectionReason: 'selected-id' | 'signature-match' | 'fallback-nonprimary' | 'fallback-primary' | 'none';
  screenStatus: 'connected' | 'absent' | 'wrong-screen' | 'fallback';
  requestedScreenMissing: boolean;
  userDataPath: string;
}

export interface CustomerDisplayNativeBridge {
  isAvailable: true;
  getStatus(): Promise<NativeDisplayStatus>;
  listDisplays(): Promise<NativeDisplayInfo[]>;
  open(): Promise<NativeDisplayStatus>;
  close(): Promise<NativeDisplayStatus>;
  reload(): Promise<NativeDisplayStatus>;
  setEnabled(enabled: boolean): Promise<NativeDisplayStatus>;
  setScreen(screenId: number | null): Promise<NativeDisplayStatus>;
  setFullscreen(fullscreen: boolean): Promise<NativeDisplayStatus>;
  setKiosk(kiosk: boolean): Promise<NativeDisplayStatus>;
  onStatus(cb: (status: NativeDisplayStatus) => void): () => void;
}

declare global {
  interface Window {
    posDesktop?: {
      isDesktop: boolean;
      platform: string;
      version: string;
    };
    customerDisplayNative?: CustomerDisplayNativeBridge;
  }
}

export {};
