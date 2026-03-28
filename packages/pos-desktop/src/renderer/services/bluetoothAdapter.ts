/**
 * Bluetooth LE Adapter — Platform-agnostic BLE abstraction
 *
 * Bridges Web Bluetooth API (desktop/PWA) and Capacitor BLE plugin (iPad native).
 * Web Bluetooth is NOT available in WKWebView (Capacitor iOS),
 * so we must use @capacitor-community/bluetooth-le on native platforms.
 */

// Lazy-import Capacitor BLE to avoid loading it on web
let CapBLE: any = null;

async function getCapBLE() {
  if (!CapBLE) {
    try {
      const mod = await import('@capacitor-community/bluetooth-le');
      CapBLE = mod.BleClient;
      await CapBLE.initialize({ androidNeverForLocation: true });
    } catch (e) {
      console.warn('[BLE-Adapter] Capacitor BLE not available:', e);
      CapBLE = null;
    }
  }
  return CapBLE;
}

export function isNativePlatform(): boolean {
  return typeof (window as any)?.Capacitor !== 'undefined' &&
    (window as any).Capacitor.isNativePlatform?.() === true;
}

export function isBLESupported(): boolean {
  if (isNativePlatform()) return true; // Capacitor BLE always supported on iOS
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/* ── Scan & Connect ── */

export interface BLEDevice {
  deviceId: string;
  name: string;
}

/**
 * Request a BLE device (shows native picker on web, scans on Capacitor)
 */
export async function requestDevice(serviceUUIDs: string[]): Promise<BLEDevice | null> {
  if (isNativePlatform()) {
    const ble = await getCapBLE();
    if (!ble) return null;

    return new Promise((resolve) => {
      let found: BLEDevice | null = null;
      const timeout = setTimeout(() => {
        ble.stopLEScan();
        resolve(found);
      }, 10000);

      ble.requestLEScan({ services: serviceUUIDs }, (result: any) => {
        if (result.device) {
          found = {
            deviceId: result.device.deviceId,
            name: result.device.name || result.localName || 'Printer',
          };
          clearTimeout(timeout);
          ble.stopLEScan();
          resolve(found);
        }
      });
    });
  }

  // Web Bluetooth
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: serviceUUIDs.map((uuid) => ({ services: [uuid] })),
      optionalServices: serviceUUIDs,
    });
    return device ? { deviceId: device.id, name: device.name || 'Device' } : null;
  } catch {
    return null;
  }
}

/**
 * Connect to a BLE device and discover a writable characteristic
 */
export async function connectAndDiscover(
  deviceId: string,
  serviceUUIDs: string[],
  characteristicUUIDs: string[],
): Promise<{ serviceId: string; characteristicId: string } | null> {
  if (isNativePlatform()) {
    const ble = await getCapBLE();
    if (!ble) return null;

    try {
      await ble.connect(deviceId);
      const services = await ble.getServices(deviceId);

      for (const svc of services) {
        const svcUUID = svc.uuid.toLowerCase();
        if (!serviceUUIDs.some((u) => svcUUID.includes(u.replace(/-/g, '').toLowerCase()))) continue;

        for (const char of svc.characteristics || []) {
          const charUUID = char.uuid.toLowerCase();
          if (characteristicUUIDs.some((u) => charUUID.includes(u.replace(/-/g, '').toLowerCase()))) {
            return { serviceId: svcUUID, characteristicId: charUUID };
          }
        }
      }
      return null;
    } catch (e) {
      console.error('[BLE-Adapter] Connect failed:', e);
      return null;
    }
  }

  // Web Bluetooth — connection is handled by the device object (not by adapter)
  // Return null to signal the caller should use Web Bluetooth's own connect flow
  return null;
}

/**
 * Write data to a BLE characteristic in chunks
 */
export async function writeData(
  deviceId: string,
  serviceId: string,
  characteristicId: string,
  data: Uint8Array,
  chunkSize = 100,
): Promise<boolean> {
  if (isNativePlatform()) {
    const ble = await getCapBLE();
    if (!ble) return false;

    try {
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        await ble.writeWithoutResponse(deviceId, serviceId, characteristicId, chunk.buffer);
        if (i + chunkSize < data.length) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
      return true;
    } catch (e) {
      console.error('[BLE-Adapter] Write failed:', e);
      return false;
    }
  }

  // Web Bluetooth: caller manages writes directly via BluetoothRemoteGATTCharacteristic
  // This path should not be reached on web — the hook uses the characteristic directly
  return false;
}

/**
 * Disconnect from a BLE device
 */
export async function disconnectDevice(deviceId: string): Promise<void> {
  if (isNativePlatform()) {
    const ble = await getCapBLE();
    if (ble) {
      try {
        await ble.disconnect(deviceId);
      } catch {
        // Already disconnected
      }
    }
  }
  // Web Bluetooth: caller manages disconnect via device.gatt.disconnect()
}
