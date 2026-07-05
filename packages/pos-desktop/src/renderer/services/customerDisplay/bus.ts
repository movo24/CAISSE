/**
 * Customer Display — cross-window message bus.
 *
 * The operator window (POS) and the customer window (client display) are two
 * separate renderer processes that share the same origin. `BroadcastChannel`
 * lets them talk without any main-process relay. This is the ONLY channel over
 * which cart/payment data reaches the display, and it is strictly one-way in
 * intent: the display subscribes and renders; it never publishes cart/payment.
 *
 * If `BroadcastChannel` is unavailable (old runtime / SSR / tests), every method
 * degrades to a safe no-op — the register keeps working, the display just does
 * not update. That is the golden rule: screen 2 can never block screen 1.
 */

import { CUSTOMER_DISPLAY_CHANNEL } from './settings';
import type { DisplaySnapshot } from './snapshot';
import type { CustomerDisplaySettings } from './settings';
import type { PaymentPhase } from './state';

/** POS → display: the current cart projection. */
export interface SnapshotMessage {
  type: 'snapshot';
  snapshot: DisplaySnapshot;
}

/** POS → display: an ephemeral payment phase change. */
export interface PaymentMessage {
  type: 'payment';
  phase: PaymentPhase;
  amountMinorUnits: number;
  changeMinorUnits: number;
  method: string | null;
}

/** Control panel → display: config changed (mode / media / QR / branding…). */
export interface ConfigMessage {
  type: 'config';
  settings: CustomerDisplaySettings;
}

/**
 * Control panel → display: a transient command that is not a persistent
 * setting (identify overlay, diagnostic patterns, force idle, ping).
 */
export interface CommandMessage {
  type: 'command';
  command:
    | 'identify'        // show "ÉCRAN CLIENT — TERMINAL 0X" for N seconds
    | 'test_pattern'    // show a 9:16 alignment/mire pattern
    | 'test_cart'       // show a synthetic demo cart
    | 'force_idle'      // drop any test/identify overlay, return to idle
    | 'ping';           // ask the display to announce itself (→ hello)
  /** Optional duration (seconds) for timed overlays like identify. */
  seconds?: number;
}

/** Display → control panel: heartbeat/ack so the dashboard shows "connected". */
export interface HelloMessage {
  type: 'hello';
  at: string;
  resolution: string;      // actual rendered "WxH"
  state: string;           // current DisplayState
  terminalLabel: string;
}

export type CustomerDisplayMessage =
  | SnapshotMessage
  | PaymentMessage
  | ConfigMessage
  | CommandMessage
  | HelloMessage;

type Handler = (msg: CustomerDisplayMessage) => void;

/** Is BroadcastChannel usable in this runtime? */
function channelSupported(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

export class CustomerDisplayBus {
  private channel: BroadcastChannel | null = null;
  private handlers = new Set<Handler>();

  constructor(private readonly name: string = CUSTOMER_DISPLAY_CHANNEL) {
    if (channelSupported()) {
      try {
        this.channel = new BroadcastChannel(this.name);
        this.channel.onmessage = (ev: MessageEvent) => {
          const msg = ev.data as CustomerDisplayMessage;
          this.handlers.forEach((h) => {
            try {
              h(msg);
            } catch (err) {
              console.error('[CustomerDisplayBus] handler error', err);
            }
          });
        };
      } catch {
        this.channel = null;
      }
    }
  }

  /** True when the bus has a live channel (not degraded to no-op). */
  get isActive(): boolean {
    return this.channel !== null;
  }

  post(message: CustomerDisplayMessage): void {
    if (!this.channel) return;
    try {
      this.channel.postMessage(message);
    } catch (err) {
      console.error('[CustomerDisplayBus] post error', err);
    }
  }

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.handlers.clear();
    try {
      this.channel?.close();
    } catch {
      /* ignore */
    }
    this.channel = null;
  }
}

/**
 * Lazily-created shared bus for the current window. Both windows import this;
 * each gets its own BroadcastChannel bound to the same channel name.
 */
let sharedBus: CustomerDisplayBus | null = null;
export function getCustomerDisplayBus(): CustomerDisplayBus {
  if (!sharedBus) sharedBus = new CustomerDisplayBus();
  return sharedBus;
}
