/**
 * useStripeTerminal — Hook for Stripe Terminal (Internet readers like WisePad 3)
 *
 * Lifecycle:
 *   1. initTerminal() — loads the SDK, fetches connection token, discovers readers
 *   2. connectReader(reader) — connects to a specific reader
 *   3. collectPayment(amount, ticketNumber) — creates PI on backend, collects on reader
 *   4. cancelPayment() — cancels in-progress collection
 *
 * This hook does NOT handle the sale creation — that's done by usePayment.
 * It only manages the reader interaction for card-present payments.
 */

import { useState, useCallback, useRef } from 'react';
import { loadStripeTerminal } from '@stripe/terminal-js';
import { stripeTerminalApi } from '../services/api';

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

export function useStripeTerminal() {
  const [status, setStatus] = useState<TerminalStatus>('idle');
  const [error, setError] = useState<TerminalError | null>(null);
  const [readers, setReaders] = useState<StripeReader[]>([]);
  const [connectedReader, setConnectedReader] = useState<StripeReader | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const terminalRef = useRef<any>(null);

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
          setConnectedReader(null);
          setStatus('idle');
          setError({ message: 'Lecteur déconnecté' });
        },
      });

      terminalRef.current = terminal;

      // Discover internet readers (WisePad 3 uses "internet" method)
      setStatus('discovering');
      const discoverResult = await terminal.discoverReaders({
        simulated: process.env.NODE_ENV !== 'production',
      });

      if ('error' in discoverResult && (discoverResult as any).error) {
        throw new Error((discoverResult as any).error.message || 'Discovery failed');
      }

      const discoveredReaders = (discoverResult as any).discoveredReaders || [];
      setReaders(discoveredReaders as StripeReader[]);
      setStatus('idle');

      return discoveredReaders;
    } catch (err: any) {
      const msg = err?.message || 'Erreur initialisation terminal';
      setError({ message: msg });
      setStatus('error');
      throw err;
    }
  }, [fetchConnectionToken]);

  /**
   * Connect to a specific reader.
   */
  const connectReader = useCallback(async (reader: StripeReader) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      setError({ message: 'Terminal non initialisé' });
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
      setStatus('connected');
    } catch (err: any) {
      setError({ message: err?.message || 'Erreur connexion lecteur' });
      setStatus('error');
      throw err;
    }
  }, []);

  /**
   * Collect a card payment via the connected reader.
   * 1. Creates PaymentIntent on backend
   * 2. Collects payment method on reader
   * 3. Processes the payment
   *
   * Returns the PaymentIntent ID on success.
   */
  const collectPayment = useCallback(async (
    amountMinorUnits: number,
    ticketNumber: string,
    currency = 'eur',
  ): Promise<{ paymentIntentId: string }> => {
    const terminal = terminalRef.current;
    if (!terminal) throw new Error('Terminal non initialisé');
    if (!connectedReader) throw new Error('Aucun lecteur connecté');

    setStatus('collecting');
    setError(null);

    try {
      // 1. Create PaymentIntent on backend
      const piRes = await stripeTerminalApi.createPaymentIntent({
        amount: amountMinorUnits,
        ticketNumber,
        currency,
      });
      const clientSecret = piRes.data.clientSecret;

      // 2. Collect payment method on reader (customer taps/inserts card)
      const collectResult = await terminal.collectPaymentMethod(clientSecret);

      if ('error' in collectResult && collectResult.error) {
        throw new Error(collectResult.error.message || 'Collection annulée');
      }

      // 3. Process the payment
      const processResult = await terminal.processPayment(
        collectResult.paymentIntent,
      );

      if ('error' in processResult && processResult.error) {
        throw new Error(processResult.error.message || 'Paiement refusé');
      }

      setStatus('connected');
      return { paymentIntentId: piRes.data.paymentIntentId };
    } catch (err: any) {
      setStatus('connected'); // Still connected to reader
      setError({ message: err?.message || 'Erreur paiement' });
      throw err;
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
    if (!terminal) return;

    try {
      await terminal.disconnectReader();
    } catch {
      // Ignore disconnect errors
    }
    setConnectedReader(null);
    setStatus('idle');
  }, []);

  return {
    // State
    status,
    error,
    readers,
    connectedReader,
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
