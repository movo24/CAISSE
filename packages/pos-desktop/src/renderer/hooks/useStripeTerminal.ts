/**
 * useStripeTerminal — Hook for Stripe Terminal (Internet readers like WisePad 3)
 *
 * Lifecycle:
 *   1. initTerminal() — loads the SDK, fetches connection token, discovers readers
 *   2. connectReader(reader, dbTerminalId?) — connects to a specific reader
 *   3. collectPayment(amount, ticketNumber) — creates PI on backend, collects on reader
 *   4. cancelPayment() — cancels in-progress collection
 *
 * This hook does NOT handle the sale creation — that's done by usePayment.
 * It only manages the reader interaction for card-present payments.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { loadStripeTerminal } from '@stripe/terminal-js';
import { stripeTerminalApi, terminalsApi } from '../services/api';

// Stripe Terminal types (simplified — the SDK's types are complex)
interface StripeReader {
  id: string;
  label: string;
  serial_number: string;
  device_type: string;
  status: string;
  ip_address?: string;
}

type TerminalStatus = 'idle' | 'loading' | 'discovering' | 'connecting' | 'connected' | 'collecting' | 'error';

interface TerminalError {
  message: string;
  code?: string;
}

const HEARTBEAT_INTERVAL_MS = 60_000; // 60 seconds
const COLLECT_TIMEOUT_MS = 120_000; // 2 minutes for customer to tap/insert
const MAX_BACKEND_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

/** Generate a unique idempotency key per payment attempt */
function makeIdempotencyKey(ticketNumber: string): string {
  return `pi_${ticketNumber}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Sleep helper for retry backoff */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Map Stripe SDK / common error codes to French user-facing messages.
 */
function getFrenchErrorMessage(err: any): string {
  const code = err?.code || err?.decline_code || '';
  const msg = (err?.message || '').toLowerCase();

  if (code === 'reader_not_found' || msg.includes('reader not found')) {
    return 'Lecteur introuvable. Verifiez qu\'il est allume et a portee.';
  }
  if (code === 'bluetooth_disabled' || msg.includes('bluetooth')) {
    return 'Bluetooth desactive. Activez le Bluetooth pour connecter le lecteur.';
  }
  if (code === 'reader_busy' || msg.includes('reader is busy') || msg.includes('busy')) {
    return 'Le lecteur est occupe. Attendez la fin de l\'operation en cours.';
  }
  if (code === 'card_declined' || msg.includes('card declined') || msg.includes('declined')) {
    return 'Carte refusee. Demandez au client un autre moyen de paiement.';
  }
  if (code === 'timed_out' || msg.includes('timeout') || msg.includes('timed out')) {
    return 'Delai d\'attente depasse. Veuillez reessayer.';
  }
  if (code === 'network_error' || msg.includes('network') || msg.includes('fetch')) {
    return 'Erreur reseau. Verifiez la connexion Internet.';
  }
  if (code === 'reader_disconnected' || msg.includes('disconnected')) {
    return 'Lecteur deconnecte. Reconnectez le lecteur.';
  }

  return err?.message || 'Erreur terminal de paiement';
}

export function useStripeTerminal() {
  const [status, setStatus] = useState<TerminalStatus>('idle');
  const [error, setError] = useState<TerminalError | null>(null);
  const [readers, setReaders] = useState<StripeReader[]>([]);
  const [connectedReader, setConnectedReader] = useState<StripeReader | null>(null);
  const [connectedTerminalId, setConnectedTerminalId] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const terminalRef = useRef<any>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Send a heartbeat to our backend for the connected terminal.
   */
  const sendHeartbeat = useCallback(async (terminalId: string, terminalStatus: string, batteryLevel?: number) => {
    try {
      await terminalsApi.heartbeat(terminalId, { status: terminalStatus, batteryLevel });
    } catch (err) {
      console.warn('[StripeTerminal] Heartbeat failed:', err);
    }
  }, []);

  /**
   * Clear heartbeat interval.
   */
  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  /**
   * Start periodic heartbeat for a terminal.
   */
  const startHeartbeat = useCallback((terminalId: string) => {
    clearHeartbeat();
    // Send immediate heartbeat
    sendHeartbeat(terminalId, 'ONLINE');
    // Set up interval
    heartbeatRef.current = setInterval(() => {
      sendHeartbeat(terminalId, 'ONLINE');
    }, HEARTBEAT_INTERVAL_MS);
  }, [clearHeartbeat, sendHeartbeat]);

  // Cleanup heartbeat on unmount
  useEffect(() => {
    return () => {
      clearHeartbeat();
    };
  }, [clearHeartbeat]);

  /**
   * Fetch a fresh connection token from our backend.
   * Called by the SDK whenever it needs a new token.
   */
  const fetchConnectionToken = useCallback(async (): Promise<string> => {
    const res = await stripeTerminalApi.connectionToken();
    return res.data.secret;
  }, []);

  /**
   * Initialize the Terminal SDK and discover readers.
   */
  const initTerminal = useCallback(async () => {
    setStatus('loading');
    setError(null);

    try {
      const StripeTerminal = await loadStripeTerminal();
      if (!StripeTerminal) {
        throw new Error('Failed to load Stripe Terminal SDK');
      }

      const terminal = StripeTerminal.create({
        onFetchConnectionToken: fetchConnectionToken,
        onUnexpectedReaderDisconnect: () => {
          console.warn('[StripeTerminal] Reader disconnected unexpectedly');
          // Send offline heartbeat if we have a terminal ID
          if (connectedTerminalId) {
            sendHeartbeat(connectedTerminalId, 'OFFLINE');
          }
          clearHeartbeat();
          setConnectedReader(null);
          setConnectedTerminalId(null);
          setStatus('idle');
          setError({ message: 'Lecteur deconnecte de maniere inattendue.' });
        },
      });

      terminalRef.current = terminal;

      // Discover internet readers (WisePad 3 uses "internet" method).
      // Simulated readers ONLY in dev builds (import.meta.env is the Vite-correct
      // check — process.env.NODE_ENV is not defined in the renderer bundle).
      setStatus('discovering');
      const discoverResult = await terminal.discoverReaders({
        simulated: !import.meta.env.PROD,
      });

      if ('error' in discoverResult && (discoverResult as any).error) {
        throw new Error((discoverResult as any).error.message || 'Discovery failed');
      }

      const discoveredReaders = (discoverResult as any).discoveredReaders || [];
      setReaders(discoveredReaders as StripeReader[]);
      setStatus('idle');

      return discoveredReaders;
    } catch (err: any) {
      const msg = getFrenchErrorMessage(err);
      setError({ message: msg, code: err?.code });
      setStatus('error');
      throw err;
    }
  }, [fetchConnectionToken, connectedTerminalId, sendHeartbeat, clearHeartbeat]);

  /**
   * Connect to a specific reader.
   * @param reader - The Stripe reader object from discovery
   * @param dbTerminalId - Optional: our database terminal ID for heartbeat tracking
   */
  const connectReader = useCallback(async (reader: StripeReader, dbTerminalId?: string) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      setError({ message: 'Terminal non initialise. Veuillez relancer la decouverte.' });
      return;
    }

    setStatus('connecting');
    setError(null);

    try {
      const result = await terminal.connectReader(reader);

      if ('error' in result && result.error) {
        throw new Error(result.error.message || 'Connection failed');
      }

      setConnectedReader(result.reader as StripeReader);
      setConnectedTerminalId(dbTerminalId || null);
      setStatus('connected');

      // Start heartbeat if we have a DB terminal ID
      if (dbTerminalId) {
        startHeartbeat(dbTerminalId);
      }
    } catch (err: any) {
      const msg = getFrenchErrorMessage(err);
      setError({ message: msg, code: err?.code });
      setStatus('error');
      throw err;
    }
  }, [startHeartbeat]);

  /**
   * Collect a card payment via the connected reader.
   * 1. Creates PaymentIntent on backend
   * 2. Collects payment method on reader
   * 3. Processes the payment
   *
   * Returns the PaymentIntent ID on success.
   */
  // Track in-flight payment to prevent double charges
  const activePaymentRef = useRef<string | null>(null);

  const collectPayment = useCallback(async (
    amountMinorUnits: number,
    ticketNumber: string,
    currency = 'eur',
  ): Promise<{ paymentIntentId: string }> => {
    const terminal = terminalRef.current;
    if (!terminal) throw new Error('Terminal non initialise');
    if (!connectedReader) throw new Error('Aucun lecteur connecte');

    // ── Double payment protection ──
    if (activePaymentRef.current) {
      throw new Error('Un paiement est deja en cours. Veuillez patienter.');
    }
    const idempotencyKey = makeIdempotencyKey(ticketNumber);
    activePaymentRef.current = idempotencyKey;

    setStatus('collecting');
    setError(null);

    try {
      // 1. Create PaymentIntent on backend (with retry)
      let piRes: any;
      for (let attempt = 0; attempt <= MAX_BACKEND_RETRIES; attempt++) {
        try {
          piRes = await stripeTerminalApi.createPaymentIntent({
            amount: amountMinorUnits,
            ticketNumber,
            currency,
          });
          break; // Success
        } catch (backendErr: any) {
          if (attempt === MAX_BACKEND_RETRIES) throw backendErr;
          console.warn(`[StripeTerminal] PI creation attempt ${attempt + 1} failed, retrying...`);
          await sleep(RETRY_DELAY_MS * (attempt + 1));
        }
      }
      const clientSecret = piRes.data.clientSecret;

      // 2. Collect payment method on reader (with timeout)
      const collectPromise = terminal.collectPaymentMethod(clientSecret);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Delai d\'attente depasse (2 min). Veuillez reessayer.')), COLLECT_TIMEOUT_MS),
      );
      const collectResult: any = await Promise.race([collectPromise, timeoutPromise]);

      if ('error' in collectResult && collectResult.error) {
        throw new Error(collectResult.error.message || 'Collection annulee');
      }

      // 3. Process the payment
      const processResult = await terminal.processPayment(
        collectResult.paymentIntent,
      );

      if ('error' in processResult && processResult.error) {
        throw new Error(processResult.error.message || 'Paiement refuse');
      }

      setStatus('connected');
      return { paymentIntentId: piRes.data.paymentIntentId };
    } catch (err: any) {
      setStatus('connected'); // Still connected to reader
      const msg = getFrenchErrorMessage(err);
      setError({ message: msg, code: err?.code });
      throw err;
    } finally {
      activePaymentRef.current = null; // Release lock
    }
  }, [connectedReader]);

  /**
   * Cancel an in-progress payment collection.
   */
  const cancelCollect = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    try {
      await terminal.cancelCollectPaymentMethod();
      setStatus('connected');
      setError(null);
    } catch (err: any) {
      console.warn('[StripeTerminal] Cancel failed:', err?.message);
    }
  }, []);

  /**
   * Disconnect from the current reader.
   */
  const disconnectReader = useCallback(async () => {
    const terminal = terminalRef.current;

    // Send offline heartbeat before disconnecting
    if (connectedTerminalId) {
      await sendHeartbeat(connectedTerminalId, 'OFFLINE');
    }
    clearHeartbeat();

    if (terminal) {
      try {
        await terminal.disconnectReader();
      } catch {
        // Ignore disconnect errors
      }
    }

    setConnectedReader(null);
    setConnectedTerminalId(null);
    setStatus('idle');
  }, [connectedTerminalId, sendHeartbeat, clearHeartbeat]);

  return {
    // State
    status,
    error,
    readers,
    connectedReader,
    connectedTerminalId,
    isReady: status === 'connected',
    isCollecting: status === 'collecting',

    // Actions
    initTerminal,
    connectReader,
    collectPayment,
    cancelCollect,
    disconnectReader,

    // Clear error
    clearError: () => setError(null),
  };
}
