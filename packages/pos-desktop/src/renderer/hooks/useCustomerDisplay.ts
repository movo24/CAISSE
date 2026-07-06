/**
 * useCustomerDisplay — the client-display window's controller (renderer).
 *
 * Subscribes read-only to the cross-window bus, owns the ephemeral display
 * state (payment phase + timers, identify/diagnostic overlays, connection
 * staleness), loads the idle video from IndexedDB, and derives the single
 * DisplayState via the pure state machine. It never touches cart/payment logic.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadSettings,
  type CustomerDisplaySettings,
  terminalLabel,
} from '../services/customerDisplay/settings';
import { getCustomerDisplayBus, type CustomerDisplayMessage } from '../services/customerDisplay/bus';
import {
  deriveDisplayState,
  type DisplayState,
  type PaymentPhase,
} from '../services/customerDisplay/state';
import {
  emptySnapshot,
  buildSnapshot,
  type DisplaySnapshot,
} from '../services/customerDisplay/snapshot';
import { getMedia } from '../services/customerDisplay/mediaStore';

export interface PaymentInfo {
  phase: PaymentPhase;
  amountMinorUnits: number;
  changeMinorUnits: number;
  method: string | null;
}

export type DisplayOverlay =
  | { kind: 'none' }
  | { kind: 'identify' }
  | { kind: 'test_pattern' }
  | { kind: 'test_cart' };

/** How long without any message (while a cart is active) counts as a lost link. */
const STALE_MS = 12_000;

const SYNTHETIC_CART: DisplaySnapshot = {
  storeName: '',
  terminalLabel: '',
  items: [
    { name: 'Article démo A', quantity: 2, unitPriceMinorUnits: 250, lineTotalMinorUnits: 500, discountMinorUnits: 0 },
    { name: 'Article démo B', quantity: 1, unitPriceMinorUnits: 1290, lineTotalMinorUnits: 1290, discountMinorUnits: 100 },
    { name: 'Article démo C', quantity: 3, unitPriceMinorUnits: 99, lineTotalMinorUnits: 297, discountMinorUnits: 0 },
  ],
  itemCount: 6,
  subtotalMinorUnits: 2087,
  totalDiscountMinorUnits: 100,
  totalMinorUnits: 1987,
  customer: { firstName: 'Démo', loyaltyPoints: 120, isFirstPurchase: false },
  at: '',
};

export interface CustomerDisplayView {
  settings: CustomerDisplaySettings;
  snapshot: DisplaySnapshot;
  payment: PaymentInfo;
  state: DisplayState;
  overlay: DisplayOverlay;
  videoUrl: string | null;
  connected: boolean;
}

export function useCustomerDisplay(): CustomerDisplayView {
  const [settings, setSettings] = useState<CustomerDisplaySettings>(() => loadSettings());
  const brandingRef = useRef({ storeName: settings.storeName, terminalLabel: terminalLabel(settings.terminalId) });
  brandingRef.current = { storeName: settings.storeName, terminalLabel: terminalLabel(settings.terminalId) };

  const [snapshot, setSnapshot] = useState<DisplaySnapshot>(() =>
    emptySnapshot(brandingRef.current, new Date().toISOString()),
  );
  const [payment, setPayment] = useState<PaymentInfo>({ phase: 'none', amountMinorUnits: 0, changeMinorUnits: 0, method: null });
  const [overlay, setOverlay] = useState<DisplayOverlay>({ kind: 'none' });
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [everConnected, setEverConnected] = useState(false);

  const lastMessageAt = useRef<number>(Date.now());
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    for (const t of [successTimer, failedTimer, identifyTimer]) {
      if (t.current) {
        clearTimeout(t.current);
        t.current = null;
      }
    }
  };

  // ── Load idle video from IndexedDB whenever the mediaId changes ──
  useEffect(() => {
    let revoked = false;
    let currentUrl: string | null = null;
    if (!settings.mediaId) {
      setVideoUrl(null);
      return;
    }
    getMedia(settings.mediaId).then((media) => {
      if (revoked) return;
      if (media?.blob) {
        currentUrl = URL.createObjectURL(media.blob);
        setVideoUrl(currentUrl);
      } else {
        setVideoUrl(null);
      }
    });
    return () => {
      revoked = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [settings.mediaId]);

  // ── Bus subscription ──
  useEffect(() => {
    const bus = getCustomerDisplayBus();

    const announce = () => {
      bus.post({
        type: 'hello',
        at: new Date().toISOString(),
        resolution: `${window.innerWidth}x${window.innerHeight}`,
        state: 'idle',
        terminalLabel: brandingRef.current.terminalLabel,
      });
    };

    const off = bus.subscribe((msg: CustomerDisplayMessage) => {
      lastMessageAt.current = Date.now();
      switch (msg.type) {
        case 'snapshot':
          setEverConnected(true);
          setConnectionLost(false);
          setSnapshot(msg.snapshot);
          break;
        case 'payment':
          setEverConnected(true);
          setConnectionLost(false);
          clearTimers();
          if (msg.phase === 'success') {
            setPayment({ phase: 'success', amountMinorUnits: msg.amountMinorUnits, changeMinorUnits: msg.changeMinorUnits, method: msg.method });
            successTimer.current = setTimeout(
              () => setPayment((p) => ({ ...p, phase: 'none' })),
              Math.max(2000, settings.successTimeoutSeconds * 1000),
            );
          } else if (msg.phase === 'failed') {
            setPayment({ phase: 'failed', amountMinorUnits: msg.amountMinorUnits, changeMinorUnits: 0, method: msg.method });
            failedTimer.current = setTimeout(() => setPayment((p) => ({ ...p, phase: 'none' })), 4500);
          } else if (msg.phase === 'pending') {
            setPayment({ phase: 'pending', amountMinorUnits: msg.amountMinorUnits, changeMinorUnits: 0, method: msg.method });
          } else {
            setPayment({ phase: 'none', amountMinorUnits: 0, changeMinorUnits: 0, method: null });
          }
          break;
        case 'config':
          setSettings(msg.settings);
          break;
        case 'command':
          if (msg.command === 'identify') {
            setOverlay({ kind: 'identify' });
            if (identifyTimer.current) clearTimeout(identifyTimer.current);
            identifyTimer.current = setTimeout(
              () => setOverlay({ kind: 'none' }),
              Math.max(2000, (msg.seconds || 10) * 1000),
            );
          } else if (msg.command === 'test_pattern') {
            setOverlay({ kind: 'test_pattern' });
          } else if (msg.command === 'test_cart') {
            setOverlay({ kind: 'test_cart' });
          } else if (msg.command === 'force_idle') {
            setOverlay({ kind: 'none' });
            setPayment({ phase: 'none', amountMinorUnits: 0, changeMinorUnits: 0, method: null });
            setSnapshot(emptySnapshot(brandingRef.current, new Date().toISOString()));
          } else if (msg.command === 'ping') {
            announce();
          }
          break;
        default:
          break;
      }
    });

    announce();
    return () => {
      off();
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.successTimeoutSeconds]);

  // ── Staleness watchdog: a cart that stops updating → error fallback ──
  useEffect(() => {
    const iv = setInterval(() => {
      if (!everConnected) return;
      const silent = Date.now() - lastMessageAt.current;
      const activeSale = snapshot.itemCount > 0 || payment.phase !== 'none';
      setConnectionLost(silent > STALE_MS && activeSale);
    }, 2000);
    return () => clearInterval(iv);
  }, [everConnected, snapshot.itemCount, payment.phase]);

  // ── Effective snapshot (test_cart overlay injects a demo cart) ──
  const effectiveSnapshot = useMemo<DisplaySnapshot>(() => {
    if (overlay.kind === 'test_cart') {
      return buildSnapshot(
        {
          items: SYNTHETIC_CART.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unitPriceMinorUnits: i.unitPriceMinorUnits,
            discountMinorUnits: i.discountMinorUnits,
          })),
          subtotalMinorUnits: SYNTHETIC_CART.subtotalMinorUnits,
          totalDiscountMinorUnits: SYNTHETIC_CART.totalDiscountMinorUnits,
          totalMinorUnits: SYNTHETIC_CART.totalMinorUnits,
          customer: SYNTHETIC_CART.customer,
        },
        brandingRef.current,
        new Date().toISOString(),
      );
    }
    return snapshot;
  }, [overlay.kind, snapshot]);

  const state = useMemo<DisplayState>(
    () =>
      deriveDisplayState({
        enabled: settings.enabled,
        blackout: settings.blackout,
        connectionLost,
        itemCount: effectiveSnapshot.itemCount,
        payment: payment.phase,
      }),
    [settings.enabled, settings.blackout, connectionLost, effectiveSnapshot.itemCount, payment.phase],
  );

  const connected = everConnected && !connectionLost;

  return { settings, snapshot: effectiveSnapshot, payment, state, overlay, videoUrl, connected };
}
