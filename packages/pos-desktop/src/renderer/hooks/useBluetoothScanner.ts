/**
 * useBluetoothScanner — Bluetooth barcode scanner gun pairing & management
 *
 * Supports Web Bluetooth API for connecting wireless barcode scanner guns.
 * These scanners typically use HID-over-GATT or SPP (Serial Port Profile).
 *
 * Common Bluetooth scanner services:
 *  - HID Service: 0x1812
 *  - Serial Port Profile: 0x1101
 *  - Custom vendor services (Zebra, Honeywell, etc.)
 */

import { useState, useCallback, useEffect, useRef } from 'react';

export type BTScannerStatus = 'disconnected' | 'searching' | 'connecting' | 'connected' | 'error';

export interface BTScannerDevice {
  id: string;
  name: string;
  device: BluetoothDevice | null;
  status: BTScannerStatus;
  lastSeen: Date;
  batteryLevel?: number;
}

export interface BluetoothScannerHook {
  /** Currently paired scanners */
  pairedScanners: BTScannerDevice[];
  /** Current pairing status */
  pairingStatus: BTScannerStatus;
  /** Error message if any */
  error: string | null;
  /** Whether Web Bluetooth is supported */
  isSupported: boolean;
  /** Start pairing a new Bluetooth scanner */
  startPairing: () => Promise<void>;
  /** Disconnect a scanner */
  disconnect: (deviceId: string) => void;
  /** Remove a scanner from the paired list */
  removePairedScanner: (deviceId: string) => void;
  /** Register a callback for scanned barcodes */
  onBarcodeScan: (callback: (code: string) => void) => () => void;
}

// Known Bluetooth scanner service UUIDs
const SCANNER_SERVICES = {
  HID: 0x1812,
  BATTERY: 0x180f,
  DEVICE_INFO: 0x180a,
  // Generic SPP-like service used by many scanners
  SPP: '00001101-0000-1000-8000-00805f9b34fb',
  // Custom services for popular brands
  ZEBRA: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  HONEYWELL: '4ce28014-b237-41fa-b88b-e80be727e4e5',
};

const STORAGE_KEY = 'caisse_bt_scanners';

export function useBluetoothScanner(): BluetoothScannerHook {
  const [pairedScanners, setPairedScanners] = useState<BTScannerDevice[]>([]);
  const [pairingStatus, setPairingStatus] = useState<BTScannerStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const callbacksRef = useRef<Set<(code: string) => void>>(new Set());

  const isSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  // Load saved scanners from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Array<{ id: string; name: string }>;
        setPairedScanners(parsed.map(s => ({
          id: s.id,
          name: s.name,
          device: null,
          status: 'disconnected' as BTScannerStatus,
          lastSeen: new Date(),
        })));
      }
    } catch { /* ignore */ }
  }, []);

  // Save paired scanners to localStorage
  const saveScanners = useCallback((scanners: BTScannerDevice[]) => {
    try {
      const toSave = scanners.map(s => ({ id: s.id, name: s.name }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch { /* ignore */ }
  }, []);

  // Process incoming data from Bluetooth characteristic
  const handleBTData = useCallback((event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    if (!value) return;

    // Decode the barcode data
    const decoder = new TextDecoder('utf-8');
    let code = '';

    // HID scanners send keycode data, SPP scanners send raw text
    const bytes = new Uint8Array(value.buffer);

    // Check if it's HID report (starts with report ID)
    if (bytes.length >= 3 && bytes[0] === 0x01) {
      // HID keyboard report: byte 0=reportID, byte 1=modifier, byte 2=reserved, bytes 3-8=keycodes
      for (let i = 2; i < bytes.length; i++) {
        const keycode = bytes[i];
        if (keycode === 0) continue;
        // Convert HID keycode to character
        const char = hidKeycodeToChar(keycode);
        if (char) code += char;
      }
    } else {
      // Raw text data (SPP mode)
      code = decoder.decode(value.buffer).trim();
    }

    if (code.length >= 3) {
      // Remove trailing CR/LF
      code = code.replace(/[\r\n]+$/, '');
      console.log(`[BT-SCAN] Barcode received: ${code}`);
      callbacksRef.current.forEach(cb => cb(code));
    }
  }, []);

  // Connect to a Bluetooth device's GATT service
  const connectToDevice = useCallback(async (device: BluetoothDevice): Promise<boolean> => {
    try {
      if (!device.gatt) return false;

      const server = await device.gatt.connect();
      let connected = false;

      // Try to find a notification-capable characteristic
      const serviceUUIDs = [
        SCANNER_SERVICES.ZEBRA,
        SCANNER_SERVICES.HONEYWELL,
      ];

      for (const uuid of serviceUUIDs) {
        try {
          const service = await server.getPrimaryService(uuid);
          const characteristics = await service.getCharacteristics();

          for (const char of characteristics) {
            if (char.properties.notify || char.properties.indicate) {
              await char.startNotifications();
              char.addEventListener('characteristicvaluechanged', handleBTData);
              connected = true;
              console.log(`[BT-SCAN] Subscribed to notifications on ${uuid}`);
              break;
            }
          }
          if (connected) break;
        } catch {
          // Service not available, try next
        }
      }

      // If no custom service found, try HID
      if (!connected) {
        try {
          const hidService = await server.getPrimaryService(SCANNER_SERVICES.HID);
          const chars = await hidService.getCharacteristics();
          for (const char of chars) {
            if (char.properties.notify) {
              await char.startNotifications();
              char.addEventListener('characteristicvaluechanged', handleBTData);
              connected = true;
              console.log('[BT-SCAN] Connected via HID service');
              break;
            }
          }
        } catch {
          // HID not available
        }
      }

      // Check battery level if available
      try {
        const batteryService = await server.getPrimaryService(SCANNER_SERVICES.BATTERY);
        const batteryChar = await batteryService.getCharacteristic(0x2a19);
        const batteryValue = await batteryChar.readValue();
        const batteryLevel = batteryValue.getUint8(0);
        setPairedScanners(prev =>
          prev.map(s => s.id === device.id ? { ...s, batteryLevel } : s)
        );
      } catch {
        // Battery service not available
      }

      // Even if we couldn't subscribe to GATT notifications,
      // many BT scanners work in keyboard-wedge mode (HID)
      // which is handled by peripheralBridge.startKeyboardWedgeListener
      if (!connected) {
        console.log('[BT-SCAN] Using keyboard wedge mode (HID)');
        connected = true; // Scanner works via keyboard events
      }

      return connected;
    } catch (e) {
      console.error('[BT-SCAN] Connection failed:', e);
      return false;
    }
  }, [handleBTData]);

  // Start pairing process
  const startPairing = useCallback(async () => {
    if (!isSupported) {
      setError('Bluetooth non supporte sur ce navigateur');
      return;
    }

    setError(null);
    setPairingStatus('searching');

    try {
      // Request device — user will see browser's Bluetooth picker
      const device = await navigator.bluetooth.requestDevice({
        // Accept all devices (scanners don't always advertise standard services)
        acceptAllDevices: true,
        optionalServices: [
          SCANNER_SERVICES.HID,
          SCANNER_SERVICES.BATTERY,
          SCANNER_SERVICES.DEVICE_INFO,
          SCANNER_SERVICES.ZEBRA,
          SCANNER_SERVICES.HONEYWELL,
        ],
      });

      if (!device) {
        setPairingStatus('disconnected');
        return;
      }

      setPairingStatus('connecting');

      const newScanner: BTScannerDevice = {
        id: device.id,
        name: device.name || 'Scanner Bluetooth',
        device,
        status: 'connecting',
        lastSeen: new Date(),
      };

      // Add to list (or update existing)
      setPairedScanners(prev => {
        const exists = prev.find(s => s.id === device.id);
        const updated = exists
          ? prev.map(s => s.id === device.id ? newScanner : s)
          : [...prev, newScanner];
        saveScanners(updated);
        return updated;
      });

      // Try GATT connection
      const connected = await connectToDevice(device);

      const finalStatus: BTScannerStatus = connected ? 'connected' : 'connected'; // Even keyboard-wedge mode counts

      setPairedScanners(prev => {
        const updated = prev.map(s =>
          s.id === device.id ? { ...s, status: finalStatus, device } : s
        );
        saveScanners(updated);
        return updated;
      });

      setPairingStatus(finalStatus);

      // Listen for disconnect
      device.addEventListener('gattserverdisconnected', () => {
        console.log(`[BT-SCAN] Device disconnected: ${device.name}`);
        setPairedScanners(prev =>
          prev.map(s => s.id === device.id ? { ...s, status: 'disconnected', device: null } : s)
        );
      });

      console.log(`[BT-SCAN] Paired with: ${device.name || device.id}`);
    } catch (e: any) {
      if (e.name === 'NotFoundError') {
        // User cancelled the picker
        setPairingStatus('disconnected');
        return;
      }
      console.error('[BT-SCAN] Pairing failed:', e);
      setError(e.message || 'Erreur de connexion Bluetooth');
      setPairingStatus('error');
    }
  }, [isSupported, connectToDevice, saveScanners]);

  // Disconnect a scanner
  const disconnect = useCallback((deviceId: string) => {
    setPairedScanners(prev => {
      return prev.map(s => {
        if (s.id === deviceId) {
          if (s.device?.gatt?.connected) {
            s.device.gatt.disconnect();
          }
          return { ...s, status: 'disconnected' as BTScannerStatus, device: null };
        }
        return s;
      });
    });
  }, []);

  // Remove a scanner from paired list
  const removePairedScanner = useCallback((deviceId: string) => {
    setPairedScanners(prev => {
      const scanner = prev.find(s => s.id === deviceId);
      if (scanner?.device?.gatt?.connected) {
        scanner.device.gatt.disconnect();
      }
      const updated = prev.filter(s => s.id !== deviceId);
      saveScanners(updated);
      return updated;
    });
  }, [saveScanners]);

  // Register barcode callback
  const onBarcodeScan = useCallback((callback: (code: string) => void) => {
    callbacksRef.current.add(callback);
    return () => { callbacksRef.current.delete(callback); };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pairedScanners.forEach(s => {
        if (s.device?.gatt?.connected) {
          try { s.device.gatt.disconnect(); } catch { /* ignore */ }
        }
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    pairedScanners,
    pairingStatus,
    error,
    isSupported,
    startPairing,
    disconnect,
    removePairedScanner,
    onBarcodeScan,
  };
}

/* ── HID Keycode to character mapping ── */

function hidKeycodeToChar(keycode: number): string | null {
  // USB HID Usage Tables — Keyboard/Keypad Page (0x07)
  const map: Record<number, string> = {
    0x04: 'a', 0x05: 'b', 0x06: 'c', 0x07: 'd', 0x08: 'e', 0x09: 'f',
    0x0A: 'g', 0x0B: 'h', 0x0C: 'i', 0x0D: 'j', 0x0E: 'k', 0x0F: 'l',
    0x10: 'm', 0x11: 'n', 0x12: 'o', 0x13: 'p', 0x14: 'q', 0x15: 'r',
    0x16: 's', 0x17: 't', 0x18: 'u', 0x19: 'v', 0x1A: 'w', 0x1B: 'x',
    0x1C: 'y', 0x1D: 'z',
    0x1E: '1', 0x1F: '2', 0x20: '3', 0x21: '4', 0x22: '5',
    0x23: '6', 0x24: '7', 0x25: '8', 0x26: '9', 0x27: '0',
    0x28: '\n', // Enter
    0x2C: ' ',  // Space
    0x2D: '-', 0x2E: '=', 0x2F: '[', 0x30: ']', 0x31: '\\',
    0x33: ';', 0x34: "'", 0x36: ',', 0x37: '.', 0x38: '/',
  };
  return map[keycode] || null;
}
