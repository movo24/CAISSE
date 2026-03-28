/**
 * useBluetoothPrinter — Bluetooth thermal receipt printer pairing & management
 *
 * Supports Web Bluetooth API for connecting wireless ESC/POS thermal printers.
 * Common BLE printer services:
 *  - Generic printer: 0x18F0 (Nordic UART-like)
 *  - Serial write char: 0x2AF1
 *  - Many Chinese printers: e7810a71-73ae-499d-8c15-faa9aef0c3f2
 *
 * Cash drawer kick is sent as ESC/POS command through the printer.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { TicketData } from '../services/peripheralBridge';
import * as BLEAdapter from '../services/bluetoothAdapter';

/* ── Types ── */

export type BTPrinterStatus = 'disconnected' | 'searching' | 'connecting' | 'connected' | 'printing' | 'error';

export interface BTPrinterDevice {
  id: string;
  name: string;
  device: BluetoothDevice | null;
  server: BluetoothRemoteGATTServer | null;
  writeCharacteristic: BluetoothRemoteGATTCharacteristic | null;
  status: BTPrinterStatus;
  lastUsed: Date;
}

export interface BluetoothPrinterHook {
  printer: BTPrinterDevice | null;
  status: BTPrinterStatus;
  error: string | null;
  isSupported: boolean;
  startPairing: () => Promise<void>;
  disconnect: () => void;
  removePrinter: () => void;
  printTicket: (data: TicketData) => Promise<boolean>;
  printTest: () => Promise<boolean>;
  openCashDrawer: () => Promise<boolean>;
}

/* ── Known BLE printer service/characteristic UUIDs ── */

const PRINTER_SERVICES = [
  // Generic thermal printer service (most common)
  '000018f0-0000-1000-8000-00805f9b34fb',
  // Nordic UART service (used by many printers)
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  // Chinese generic BLE printer
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  // Another common variant
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];

const WRITE_CHARACTERISTICS = [
  // Standard write characteristic
  '00002af1-0000-1000-8000-00805f9b34fb',
  // Nordic UART TX
  '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  // Chinese generic
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  // Another variant
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
];

const STORAGE_KEY = 'caisse_bt_printer';
const BLE_CHUNK_SIZE = 100; // Bytes per BLE write (larger than 20 for modern devices)

/* ── ESC/POS helpers ── */

const ESC = 0x1B;
const GS = 0x1D;
const LF = 0x0A;

function textToBytes(text: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(text);
}

function buildESCPOSBytes(data: TicketData): Uint8Array {
  const parts: Uint8Array[] = [];

  const cmd = (...bytes: number[]) => parts.push(new Uint8Array(bytes));
  const text = (s: string) => parts.push(textToBytes(s));
  const nl = () => cmd(LF);
  const line = () => { text('--------------------------------'); nl(); };

  // Initialize printer
  cmd(ESC, 0x40); // ESC @ — reset

  // Center align
  cmd(ESC, 0x61, 0x01);
  // Bold on
  cmd(ESC, 0x45, 0x01);
  // Double height for store name
  cmd(ESC, 0x21, 0x10);
  text(data.storeName); nl();
  // Normal size
  cmd(ESC, 0x21, 0x00);
  // Bold off
  cmd(ESC, 0x45, 0x00);

  text(data.storeAddress); nl();
  text(`SIRET: ${data.siret}`); nl();
  if (data.tvaIntracom) { text(`TVA: ${data.tvaIntracom}`); nl(); }
  nl();

  // Left align
  cmd(ESC, 0x61, 0x00);
  line();
  text(`Ticket: ${data.ticketNumber}`); nl();
  text(`Date: ${data.date}`); nl();
  text(`Caissier: ${data.cashierName}`); nl();
  line();

  // Items
  for (const item of data.items) {
    const nameStr = item.name.length > 24 ? item.name.slice(0, 24) : item.name;
    const totalStr = item.total.toFixed(2);
    const qtyStr = `${item.quantity}x${item.unitPrice.toFixed(2)}`;
    text(nameStr); nl();
    // Right-pad qty, right-align total
    const spacing = 32 - qtyStr.length - totalStr.length;
    text(`  ${qtyStr}${' '.repeat(Math.max(1, spacing))}${totalStr}`); nl();
    if (item.discount && item.discount > 0) {
      text(`  Remise: -${item.discount.toFixed(2)}`); nl();
    }
  }

  line();

  // Totals — bold
  cmd(ESC, 0x45, 0x01);
  cmd(ESC, 0x21, 0x10); // Double height
  const totalLabel = 'TOTAL';
  const totalVal = `${data.total.toFixed(2)} EUR`;
  const totalSpacing = 32 - totalLabel.length - totalVal.length;
  text(`${totalLabel}${' '.repeat(Math.max(1, totalSpacing))}${totalVal}`); nl();
  cmd(ESC, 0x21, 0x00); // Normal
  cmd(ESC, 0x45, 0x00);

  if (data.discount > 0) {
    text(`Remise:           -${data.discount.toFixed(2)} EUR`); nl();
  }

  line();

  // Payments
  for (const p of data.payments) {
    const mLabel = p.method === 'card' ? 'CB' : p.method === 'cash' ? 'Especes' : p.method;
    const pVal = `${p.amount.toFixed(2)} EUR`;
    const pSpacing = 32 - mLabel.length - pVal.length;
    text(`${mLabel}${' '.repeat(Math.max(1, pSpacing))}${pVal}`); nl();
  }
  if (data.change > 0) {
    text(`Rendu: ${data.change.toFixed(2)} EUR`); nl();
  }

  line();

  // Footer — centered
  cmd(ESC, 0x61, 0x01);
  text(data.footer); nl();
  text(`NIF: ${data.nifCaisse}`); nl();
  text(`v${data.softwareVersion}`); nl();
  nl(); nl();

  // Cut paper
  cmd(GS, 0x56, 0x00); // Full cut

  // Concatenate all parts
  const totalLength = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function buildTestTicketBytes(): Uint8Array {
  const parts: Uint8Array[] = [];
  const cmd = (...bytes: number[]) => parts.push(new Uint8Array(bytes));
  const text = (s: string) => parts.push(textToBytes(s));
  const nl = () => cmd(LF);

  cmd(ESC, 0x40); // Reset
  cmd(ESC, 0x61, 0x01); // Center
  cmd(ESC, 0x45, 0x01); // Bold
  cmd(ESC, 0x21, 0x10); // Double height
  text('TEST IMPRIMANTE'); nl();
  cmd(ESC, 0x21, 0x00);
  cmd(ESC, 0x45, 0x00);
  nl();
  text('CAISSE POS'); nl();
  text('--------------------------------'); nl();
  cmd(ESC, 0x61, 0x00); // Left
  text('Impression de test reussie !'); nl();
  text(`Date: ${new Date().toLocaleString('fr-FR')}`); nl();
  text('--------------------------------'); nl();
  cmd(ESC, 0x61, 0x01); // Center
  text('Merci et bonne journee'); nl();
  nl(); nl();
  cmd(GS, 0x56, 0x00); // Cut

  const totalLength = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function buildCashDrawerKickBytes(): Uint8Array {
  // ESC p 0 25 250 — Standard cash drawer kick pulse
  // Pin 2 (most common), on-time 25*2ms=50ms, off-time 250*2ms=500ms
  return new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xFA]);
}

/* ── Hook ── */

export function useBluetoothPrinter(): BluetoothPrinterHook {
  const [printer, setPrinter] = useState<BTPrinterDevice | null>(null);
  const [status, setStatus] = useState<BTPrinterStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const printerRef = useRef<BTPrinterDevice | null>(null);

  const isSupported = BLEAdapter.isBLESupported();

  // Keep ref in sync
  useEffect(() => { printerRef.current = printer; }, [printer]);

  // Load saved printer from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { id: string; name: string };
        setPrinter({
          id: parsed.id,
          name: parsed.name,
          device: null,
          server: null,
          writeCharacteristic: null,
          status: 'disconnected',
          lastUsed: new Date(),
        });
      }
    } catch { /* ignore */ }
  }, []);

  // Save printer to localStorage
  const savePrinter = useCallback((p: BTPrinterDevice | null) => {
    try {
      if (p) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: p.id, name: p.name }));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  // Write data to BLE characteristic in chunks
  const writeToDevice = useCallback(async (data: Uint8Array): Promise<boolean> => {
    const p = printerRef.current;
    if (!p?.writeCharacteristic) {
      console.error('[BT-PRINT] No write characteristic available');
      return false;
    }

    try {
      // Send in chunks to respect BLE MTU
      for (let i = 0; i < data.length; i += BLE_CHUNK_SIZE) {
        const chunk = data.slice(i, i + BLE_CHUNK_SIZE);
        await (p.writeCharacteristic as any).writeValueWithoutResponse?.(chunk) ?? p.writeCharacteristic.writeValue(chunk);
        // Small delay between chunks to let printer process
        if (i + BLE_CHUNK_SIZE < data.length) {
          await new Promise(r => setTimeout(r, 20));
        }
      }
      return true;
    } catch (e) {
      console.error('[BT-PRINT] Write failed:', e);
      // Try reconnecting
      try {
        if (p.device?.gatt) {
          const server = await p.device.gatt.connect();
          const char = await findWriteCharacteristic(server);
          if (char) {
            const updated = { ...p, server, writeCharacteristic: char, status: 'connected' as BTPrinterStatus };
            setPrinter(updated);
            // Retry write
            for (let i = 0; i < data.length; i += BLE_CHUNK_SIZE) {
              const chunk = data.slice(i, i + BLE_CHUNK_SIZE);
              await (char as any).writeValueWithoutResponse?.(chunk) ?? char.writeValue(chunk);
              if (i + BLE_CHUNK_SIZE < data.length) await new Promise(r => setTimeout(r, 20));
            }
            return true;
          }
        }
      } catch (reconnectErr) {
        console.error('[BT-PRINT] Reconnect failed:', reconnectErr);
      }
      return false;
    }
  }, []);

  // Start pairing
  const startPairing = useCallback(async () => {
    if (!isSupported) {
      setError('Bluetooth non supporte sur ce navigateur');
      return;
    }

    setError(null);
    setStatus('searching');

    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICES,
      });

      if (!device) {
        setStatus('disconnected');
        return;
      }

      setStatus('connecting');

      if (!device.gatt) {
        setError("L'appareil ne supporte pas GATT");
        setStatus('error');
        return;
      }

      const server = await device.gatt.connect();
      const writeChar = await findWriteCharacteristic(server);

      if (!writeChar) {
        setError('Aucune caracteristique compatible trouvee. Verifiez que votre imprimante est bien en mode BLE.');
        setStatus('error');
        device.gatt.disconnect();
        return;
      }

      const newPrinter: BTPrinterDevice = {
        id: device.id,
        name: device.name || 'Imprimante Bluetooth',
        device,
        server,
        writeCharacteristic: writeChar,
        status: 'connected',
        lastUsed: new Date(),
      };

      setPrinter(newPrinter);
      savePrinter(newPrinter);
      setStatus('connected');

      // Listen for disconnect
      device.addEventListener('gattserverdisconnected', () => {
        console.log(`[BT-PRINT] Printer disconnected: ${device.name}`);
        setPrinter(prev => prev ? { ...prev, status: 'disconnected', server: null, writeCharacteristic: null } : null);
        setStatus('disconnected');
      });

      console.log(`[BT-PRINT] Paired with: ${device.name || device.id}`);
    } catch (e: any) {
      if (e.name === 'NotFoundError') {
        setStatus('disconnected');
        return;
      }
      console.error('[BT-PRINT] Pairing failed:', e);
      setError(e.message || 'Erreur de connexion Bluetooth');
      setStatus('error');
    }
  }, [isSupported, savePrinter]);

  // Reconnect to saved printer
  const reconnect = useCallback(async () => {
    const p = printerRef.current;
    if (!p?.device?.gatt || p.status === 'connected') return;

    try {
      setStatus('connecting');
      const server = await p.device.gatt.connect();
      const writeChar = await findWriteCharacteristic(server);
      if (writeChar) {
        const updated = { ...p, server, writeCharacteristic: writeChar, status: 'connected' as BTPrinterStatus };
        setPrinter(updated);
        setStatus('connected');
        console.log('[BT-PRINT] Reconnected');
      }
    } catch (e) {
      console.warn('[BT-PRINT] Reconnect failed:', e);
    }
  }, []);

  // Auto-reconnect when printer is saved but disconnected
  useEffect(() => {
    if (printer?.device && printer.status === 'disconnected') {
      const timer = setTimeout(reconnect, 1000);
      return () => clearTimeout(timer);
    }
  }, [printer?.status, reconnect]);

  // Disconnect
  const disconnect = useCallback(() => {
    const p = printerRef.current;
    if (p?.device?.gatt?.connected) {
      p.device.gatt.disconnect();
    }
    setPrinter(prev => prev ? { ...prev, status: 'disconnected', server: null, writeCharacteristic: null } : null);
    setStatus('disconnected');
  }, []);

  // Remove printer
  const removePrinter = useCallback(() => {
    disconnect();
    setPrinter(null);
    savePrinter(null);
    setStatus('disconnected');
  }, [disconnect, savePrinter]);

  // Print ticket
  const printTicket = useCallback(async (data: TicketData): Promise<boolean> => {
    if (!printerRef.current?.writeCharacteristic) {
      console.warn('[BT-PRINT] No printer connected');
      return false;
    }

    setStatus('printing');
    try {
      const escpos = buildESCPOSBytes(data);
      const success = await writeToDevice(escpos);
      setStatus(success ? 'connected' : 'error');
      if (success) {
        setPrinter(prev => prev ? { ...prev, lastUsed: new Date() } : null);
        console.log('[BT-PRINT] Ticket printed successfully');
      }
      return success;
    } catch (e) {
      console.error('[BT-PRINT] Print failed:', e);
      setStatus('error');
      return false;
    }
  }, [writeToDevice]);

  // Print test page
  const printTest = useCallback(async (): Promise<boolean> => {
    if (!printerRef.current?.writeCharacteristic) {
      setError('Aucune imprimante connectee');
      return false;
    }

    setStatus('printing');
    try {
      const testBytes = buildTestTicketBytes();
      const success = await writeToDevice(testBytes);
      setStatus(success ? 'connected' : 'error');
      return success;
    } catch (e) {
      console.error('[BT-PRINT] Test print failed:', e);
      setStatus('error');
      return false;
    }
  }, [writeToDevice]);

  // Open cash drawer via ESC/POS kick pulse
  const openCashDrawer = useCallback(async (): Promise<boolean> => {
    if (!printerRef.current?.writeCharacteristic) {
      console.warn('[BT-PRINT] No printer for drawer kick');
      return false;
    }

    try {
      const kickBytes = buildCashDrawerKickBytes();
      const success = await writeToDevice(kickBytes);
      if (success) console.log('[BT-PRINT] Cash drawer kick sent');
      return success;
    } catch (e) {
      console.error('[BT-PRINT] Drawer kick failed:', e);
      return false;
    }
  }, [writeToDevice]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const p = printerRef.current;
      // Don't disconnect on unmount — keep connection alive for background printing
    };
  }, []);

  return {
    printer,
    status,
    error,
    isSupported,
    startPairing,
    disconnect,
    removePrinter,
    printTicket,
    printTest,
    openCashDrawer,
  };
}

/* ── Helper: find a writable characteristic across known services ── */

async function findWriteCharacteristic(
  server: BluetoothRemoteGATTServer
): Promise<BluetoothRemoteGATTCharacteristic | null> {
  for (const serviceUUID of PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(serviceUUID);
      const characteristics = await service.getCharacteristics();

      // First try known write characteristic UUIDs
      for (const charUUID of WRITE_CHARACTERISTICS) {
        const match = characteristics.find(c => c.uuid === charUUID);
        if (match && (c_canWrite(match))) {
          console.log(`[BT-PRINT] Found write char ${charUUID} on service ${serviceUUID}`);
          return match;
        }
      }

      // Fallback: find any writable characteristic
      for (const char of characteristics) {
        if (c_canWrite(char)) {
          console.log(`[BT-PRINT] Found writable char ${char.uuid} on service ${serviceUUID}`);
          return char;
        }
      }
    } catch {
      // Service not available, try next
    }
  }
  return null;
}

function c_canWrite(char: BluetoothRemoteGATTCharacteristic): boolean {
  return char.properties.write || char.properties.writeWithoutResponse;
}
