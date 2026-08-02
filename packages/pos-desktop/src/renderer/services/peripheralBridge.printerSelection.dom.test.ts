// @vitest-environment jsdom
/**
 * Sélection de l'imprimante sur le poste Windows.
 *
 * Deux silences ont coûté du temps terrain, verrouillés ici :
 *  1. une entrée Bluetooth RÉSIDUELLE masquait l'imprimante USB — le shell
 *     Windows n'enregistre jamais les fonctions BLE, donc la caisse devenait
 *     muette (ni ticket ni tiroir) sans le moindre message ;
 *  2. une imprimante mémorisée DISPARUE était remplacée en silence.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { peripheralBridge } from './peripheralBridge';

const STAR = 'Star TSP100 Cutter (TSP143)';

function installElectronApi(printers: string[]) {
  (window as any).electronAPI = {
    getPrinters: vi.fn().mockResolvedValue(printers),
    getPrinterInfo: vi.fn().mockResolvedValue({ ok: true, driverName: STAR, portName: 'USB001' }),
    listQueues: vi.fn().mockResolvedValue({ ok: true, queues: printers.map((name) => ({ name })) }),
    openCashDrawer: vi.fn(),
  };
}

beforeEach(() => {
  localStorage.clear();
  delete (window as any).electronAPI;
  peripheralBridge.printerWarning = null;
});

describe('imprimante Bluetooth résiduelle sur poste Windows', () => {
  it('NE masque PAS l’imprimante USB détectée par Windows', async () => {
    localStorage.setItem('caisse_bt_printer', JSON.stringify({ name: 'BLE-58mm' }));
    installElectronApi([STAR]);

    await peripheralBridge.init('windows');

    expect(peripheralBridge.status.printer.type).toBe('thermal_usb');
    expect(peripheralBridge.status.printer.name).toBe(STAR);
    expect(peripheralBridge.status.printer.connected).toBe(true);
  });

  it('avertit explicitement que l’entrée Bluetooth est ignorée', async () => {
    localStorage.setItem('caisse_bt_printer', JSON.stringify({ name: 'BLE-58mm' }));
    installElectronApi([STAR]);

    await peripheralBridge.init('windows');

    expect(peripheralBridge.printerWarning).toBeTruthy();
    expect(peripheralBridge.printerWarning).toContain('BLE-58mm');
    expect(peripheralBridge.printerWarning).toContain(STAR);
  });

  it('le tiroir redevient « printer_kick » (et non « bluetooth » sans fonction)', async () => {
    localStorage.setItem('caisse_bt_printer', JSON.stringify({ name: 'BLE-58mm' }));
    installElectronApi([STAR]);

    await peripheralBridge.init('windows');

    expect(peripheralBridge.status.cashDrawer.type).toBe('printer_kick');
  });

  it('AUCUNE imprimante Windows → on retombe sur le Bluetooth mémorisé (iPad/secours)', async () => {
    localStorage.setItem('caisse_bt_printer', JSON.stringify({ name: 'BLE-58mm' }));
    installElectronApi([]);

    await peripheralBridge.init('windows');

    expect(peripheralBridge.status.printer.type).toBe('thermal_bluetooth');
    expect(peripheralBridge.status.printer.name).toBe('BLE-58mm');
  });
});

describe('imprimante mémorisée', () => {
  it('restaurée quand elle existe toujours', async () => {
    localStorage.setItem('caisse_os_printer', STAR);
    installElectronApi(['Microsoft Print to PDF', STAR]);

    await peripheralBridge.init('windows');

    expect(peripheralBridge.status.printer.name).toBe(STAR);
    expect(peripheralBridge.printerWarning).toBeNull();
  });

  it('disparue → repli explicite ET avertissement nommant l’ancienne', async () => {
    localStorage.setItem('caisse_os_printer', 'Star TSP143 (ancien nom)');
    installElectronApi([STAR]);

    await peripheralBridge.init('windows');

    expect(peripheralBridge.status.printer.name).toBe(STAR);
    expect(peripheralBridge.printerWarning).toContain('Star TSP143 (ancien nom)');
  });
});
