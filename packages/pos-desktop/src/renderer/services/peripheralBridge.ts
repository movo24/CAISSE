/**
 * peripheralBridge — Unified peripheral access layer
 *
 * Abstracts hardware access across platforms:
 *  - Windows: USB thermal printers (ESC/POS), cash drawers, barcode scanners
 *  - iPad:    AirPrint, Bluetooth printers, camera barcode scan
 *  - Web:     WebUSB fallback, camera API
 */

import { DevicePlatform } from '../hooks/useDeviceProfile';

/* ═══════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════ */

export type PrinterType = 'thermal_usb' | 'thermal_bluetooth' | 'airprint' | 'browser_print' | 'none';
export type ScannerType = 'usb_hid' | 'bluetooth' | 'camera' | 'keyboard_wedge' | 'none';
export type CashDrawerType = 'usb' | 'printer_kick' | 'bluetooth' | 'none';

export interface PeripheralStatus {
  printer: { type: PrinterType; connected: boolean; name: string | null };
  scanner: { type: ScannerType; connected: boolean; name: string | null };
  cashDrawer: { type: CashDrawerType; connected: boolean };
}

export interface TicketData {
  storeName: string;
  storeAddress: string;
  siret: string;
  tvaIntracom: string;
  ticketNumber: string;
  date: string;
  cashierName: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
    discount?: number;
  }>;
  subtotal: number;
  discount: number;
  total: number;
  payments: Array<{ method: string; amount: number }>;
  change: number;
  footer: string;
  nifCaisse: string;
  softwareVersion: string;
}

export interface BarcodeResult {
  code: string;
  format: string;
  timestamp: number;
}

type BarcodeCallback = (result: BarcodeResult) => void;

/* ═══════════════════════════════════════════════════
   PERIPHERAL BRIDGE
   ═══════════════════════════════════════════════════ */

class PeripheralBridge {
  private platform: DevicePlatform = 'unknown';
  private _status: PeripheralStatus = {
    printer: { type: 'none', connected: false, name: null },
    scanner: { type: 'none', connected: false, name: null },
    cashDrawer: { type: 'none', connected: false },
  };
  private barcodeCallbacks: Set<BarcodeCallback> = new Set();
  private _btPrintFn: ((data: TicketData) => Promise<boolean>) | null = null;
  private _btDrawerFn: (() => Promise<boolean>) | null = null;
  private keyboardBuffer = '';
  private keyboardTimeout: ReturnType<typeof setTimeout> | null = null;
  private cameraStream: MediaStream | null = null;
  private scanInterval: ReturnType<typeof setInterval> | null = null;

  /* ── Init ── */

  async init(platform: DevicePlatform): Promise<PeripheralStatus> {
    this.platform = platform;
    console.log(`[PERIPH] Initializing for platform: ${platform}`);

    await this.detectPrinter();
    await this.detectScanner();
    this.detectCashDrawer();

    console.log('[PERIPH] Status:', JSON.stringify(this._status));
    return this._status;
  }

  get status(): PeripheralStatus {
    return this._status;
  }

  /* ═══════════════════════════════════════════════
     PRINTER
     ═══════════════════════════════════════════════ */

  private async detectPrinter(): Promise<void> {
    // Check for saved Bluetooth printer first (works on all platforms)
    try {
      const saved = localStorage.getItem('caisse_bt_printer');
      if (saved) {
        const parsed = JSON.parse(saved);
        this._status.printer = { type: 'thermal_bluetooth', connected: false, name: parsed.name || 'Imprimante BLE' };
        // Actual connection managed by useBluetoothPrinter hook
        return;
      }
    } catch { /* ignore */ }

    if (this.isElectron()) {
      try {
        const electronPrinters = await this.getElectronPrinters();
        if (electronPrinters.length > 0) {
          this._status.printer = { type: 'thermal_usb', connected: true, name: electronPrinters[0] };
          return;
        }
      } catch (e) {
        console.warn('[PERIPH] Electron printer detection failed:', e);
      }
    }

    // iPad/browser: no real printer by default — set to 'none'
    // A real printer (Bluetooth thermal) will be registered via useBluetoothPrinter
    // This prevents the browser print dialog from appearing on every sale
    this._status.printer = { type: 'none', connected: false, name: null };
  }

  /** Register Bluetooth printer functions from useBluetoothPrinter hook */
  registerBluetoothPrinter(
    printFn: (data: TicketData) => Promise<boolean>,
    drawerFn: () => Promise<boolean>,
  ): void {
    this._btPrintFn = printFn;
    this._btDrawerFn = drawerFn;
  }

  /** Update printer status from useBluetoothPrinter hook */
  updateBluetoothPrinterStatus(connected: boolean, name: string | null): void {
    if (connected && name) {
      this._status.printer = { type: 'thermal_bluetooth', connected: true, name };
      this._status.cashDrawer = { type: 'bluetooth', connected: true };
    } else {
      // If disconnected and was BT, reset to fallback
      if (this._status.printer.type === 'thermal_bluetooth') {
        this._status.printer = { type: 'browser_print', connected: true, name: 'Navigateur' };
        this._status.cashDrawer = { type: 'none', connected: false };
      }
    }
  }

  /**
   * Print a ticket. `allowBrowserFallback: false` (sale auto-print) makes a failed
   * thermal print return FALSE instead of silently opening the browser print dialog
   * — the caller must tell the cashier the ticket was NOT printed (no fake print).
   * Explicit reprints keep the default fallback (user-initiated dialog is fine).
   */
  async printTicket(data: TicketData, opts?: { allowBrowserFallback?: boolean }): Promise<boolean> {
    const allowBrowserFallback = opts?.allowBrowserFallback !== false;
    const { type, connected } = this._status.printer;

    // Use registered BT printer function if available and connected
    if (type === 'thermal_bluetooth' && connected && this._btPrintFn) {
      try {
        const result = await this._btPrintFn(data);
        if (result) return true;
      } catch (e) {
        console.warn('[PERIPH] BT print via hook failed, fallback:', e);
      }
      if (!allowBrowserFallback) return false; // honest failure, no dialog
    }

    switch (type) {
      case 'thermal_usb': {
        const ok = await this.printThermalUSB(data, allowBrowserFallback);
        return ok;
      }
      case 'thermal_bluetooth': {
        const ok = await this.printThermalBluetooth(data, allowBrowserFallback);
        return ok;
      }
      case 'airprint':
      case 'browser_print':
      default:
        return allowBrowserFallback ? this.printBrowserFallback(data) : false;
    }
  }

  private async printThermalUSB(data: TicketData, allowBrowserFallback = true): Promise<boolean> {
    try {
      // Desktop (PR #33) : impression RÉELLE via le spooler OS d'Electron —
      // reçu HTML 80 mm construit par DOM sûr, imprimé en silencieux. Un échec
      // résout { ok:false } côté main → false honnête ici, jamais de faux succès.
      if (this.isElectron() && (window as any).electronAPI?.printTicketHtml) {
        const html = this.buildReceiptHtml(data);
        const result = await (window as any).electronAPI.printTicketHtml(html);
        if (result?.ok) {
          console.log('[PERIPH] Desktop OS print success');
          return true;
        }
        console.warn('[PERIPH] Desktop OS print failed:', result?.error);
        return allowBrowserFallback ? this.printBrowserFallback(data) : false;
      }
      if ('usb' in navigator) return this.printWebUSB(data, allowBrowserFallback);
      return allowBrowserFallback ? this.printBrowserFallback(data) : false;
    } catch (e) {
      console.error('[PERIPH] Thermal USB print failed:', e);
      return allowBrowserFallback ? this.printBrowserFallback(data) : false;
    }
  }

  /** Serialize the safe receipt DOM (escaped values) to standalone HTML for the main process. */
  private buildReceiptHtml(data: TicketData): string {
    const doc = document.implementation.createHTMLDocument('ticket');
    this.buildReceiptDOM(doc, data);
    return '<!doctype html>' + doc.documentElement.outerHTML;
  }

  private async printWebUSB(data: TicketData, allowBrowserFallback = true): Promise<boolean> {
    try {
      const device = await (navigator as any).usb.requestDevice({ filters: [{ classCode: 7 }] });
      await device.open();
      await device.selectConfiguration(1);
      await device.claimInterface(0);
      const commands = this.buildESCPOSCommands(data);
      const encoder = new TextEncoder();
      await device.transferOut(1, encoder.encode(commands));
      await device.close();
      console.log('[PERIPH] WebUSB print success');
      return true;
    } catch (e) {
      console.warn('[PERIPH] WebUSB failed, fallback:', e);
      return allowBrowserFallback ? this.printBrowserFallback(data) : false;
    }
  }

  private async printThermalBluetooth(data: TicketData, allowBrowserFallback = true): Promise<boolean> {
    try {
      if (!('bluetooth' in navigator)) return allowBrowserFallback ? this.printBrowserFallback(data) : false;
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
      });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
      const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
      const commands = this.buildESCPOSCommands(data);
      const encoder = new TextEncoder();
      const bytes = encoder.encode(commands);
      for (let i = 0; i < bytes.length; i += 20) {
        await characteristic.writeValue(bytes.slice(i, i + 20));
      }
      console.log('[PERIPH] Bluetooth print success');
      return true;
    } catch (e) {
      console.warn('[PERIPH] Bluetooth print failed:', e);
      return allowBrowserFallback ? this.printBrowserFallback(data) : false;
    }
  }

  private printBrowserFallback(data: TicketData): boolean {
    // Use a hidden iframe for safe printing without XSS risk
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:300px;height:600px;';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      document.body.removeChild(iframe);
      return false;
    }

    // Build receipt content using safe DOM methods
    this.buildReceiptDOM(iframeDoc, data);

    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 2000);
    return true;
  }

  private buildReceiptDOM(doc: Document, data: TicketData): void {
    // Add print styles
    const style = doc.createElement('style');
    style.textContent = `
      @page { size: 80mm auto; margin: 0; }
      body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 4mm auto; color: #000; }
      .center { text-align: center; }
      .bold { font-weight: bold; }
      .line { border-top: 1px dashed #000; margin: 4px 0; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 1px 0; font-size: 11px; }
      .row { display: flex; justify-content: space-between; }
    `;
    doc.head.appendChild(style);

    const body = doc.body;

    // Store name
    const h = doc.createElement('div');
    h.className = 'center bold';
    h.style.fontSize = '14px';
    h.textContent = data.storeName;
    body.appendChild(h);

    // Address
    const addr = doc.createElement('div');
    addr.className = 'center';
    addr.style.fontSize = '10px';
    addr.textContent = data.storeAddress;
    body.appendChild(addr);

    // SIRET / TVA
    const ids = doc.createElement('div');
    ids.className = 'center';
    ids.style.fontSize = '9px';
    ids.textContent = `SIRET: ${data.siret} | TVA: ${data.tvaIntracom}`;
    body.appendChild(ids);

    body.appendChild(this.makeLine(doc));

    // Ticket info
    for (const line of [`Ticket: ${data.ticketNumber}`, `Date: ${data.date}`, `Caissier: ${data.cashierName}`]) {
      const d = doc.createElement('div');
      d.textContent = line;
      body.appendChild(d);
    }

    body.appendChild(this.makeLine(doc));

    // Items table
    const table = doc.createElement('table');
    for (const item of data.items) {
      const tr = doc.createElement('tr');
      const tdName = doc.createElement('td');
      tdName.style.textAlign = 'left';
      tdName.textContent = item.name;
      const tdQty = doc.createElement('td');
      tdQty.style.textAlign = 'center';
      tdQty.textContent = String(item.quantity);
      const tdTotal = doc.createElement('td');
      tdTotal.style.textAlign = 'right';
      tdTotal.textContent = item.total.toFixed(2);
      tr.appendChild(tdName);
      tr.appendChild(tdQty);
      tr.appendChild(tdTotal);
      table.appendChild(tr);
    }
    body.appendChild(table);

    body.appendChild(this.makeLine(doc));

    // Total
    const totalRow = doc.createElement('div');
    totalRow.className = 'row bold';
    const totalLabel = doc.createElement('span');
    totalLabel.textContent = 'TOTAL';
    const totalVal = doc.createElement('span');
    totalVal.textContent = `${data.total.toFixed(2)} EUR`;
    totalRow.appendChild(totalLabel);
    totalRow.appendChild(totalVal);
    body.appendChild(totalRow);

    body.appendChild(this.makeLine(doc));

    // Payments
    for (const p of data.payments) {
      const r = doc.createElement('div');
      r.className = 'row';
      const m = doc.createElement('span');
      m.textContent = p.method;
      const a = doc.createElement('span');
      a.textContent = `${p.amount.toFixed(2)} EUR`;
      r.appendChild(m);
      r.appendChild(a);
      body.appendChild(r);
    }
    if (data.change > 0) {
      const c = doc.createElement('div');
      c.textContent = `Rendu: ${data.change.toFixed(2)} EUR`;
      body.appendChild(c);
    }

    body.appendChild(this.makeLine(doc));

    // Footer
    const foot = doc.createElement('div');
    foot.className = 'center';
    foot.style.fontSize = '10px';
    foot.textContent = data.footer;
    body.appendChild(foot);

    const nif = doc.createElement('div');
    nif.className = 'center';
    nif.style.fontSize = '9px';
    nif.textContent = `NIF: ${data.nifCaisse} | v${data.softwareVersion}`;
    body.appendChild(nif);
  }

  private makeLine(doc: Document): HTMLDivElement {
    const d = doc.createElement('div');
    d.className = 'line';
    return d;
  }

  private buildESCPOSCommands(data: TicketData): string {
    const ESC = '\x1B';
    const GS = '\x1D';
    const lines: string[] = [];
    lines.push(`${ESC}@`);
    lines.push(`${ESC}a\x01`);
    lines.push(`${ESC}E\x01`);
    lines.push(data.storeName);
    lines.push(`${ESC}E\x00`);
    lines.push(data.storeAddress);
    lines.push(`SIRET: ${data.siret}`);
    lines.push(`TVA: ${data.tvaIntracom}`);
    lines.push('');
    lines.push(`${ESC}a\x00`);
    lines.push(`Ticket: ${data.ticketNumber}`);
    lines.push(`Date: ${data.date}`);
    lines.push(`Caissier: ${data.cashierName}`);
    lines.push('--------------------------------');
    for (const item of data.items) {
      lines.push(item.name);
      lines.push(`  ${item.quantity} x ${item.unitPrice.toFixed(2)}    ${item.total.toFixed(2)} EUR`);
      if (item.discount && item.discount > 0) lines.push(`  Remise: -${item.discount.toFixed(2)} EUR`);
    }
    lines.push('--------------------------------');
    lines.push(`TOTAL:            ${data.total.toFixed(2)} EUR`);
    if (data.discount > 0) lines.push(`Remise:           -${data.discount.toFixed(2)} EUR`);
    lines.push('');
    for (const p of data.payments) lines.push(`${p.method}: ${p.amount.toFixed(2)} EUR`);
    if (data.change > 0) lines.push(`Rendu: ${data.change.toFixed(2)} EUR`);
    lines.push('');
    lines.push(`${ESC}a\x01`);
    lines.push(data.footer);
    lines.push(`NIF: ${data.nifCaisse}`);
    lines.push(`v${data.softwareVersion}`);
    lines.push('');
    lines.push(`${GS}V\x00`);
    return lines.join('\n');
  }

  /* ═══════════════════════════════════════════════
     BARCODE SCANNER
     ═══════════════════════════════════════════════ */

  private async detectScanner(): Promise<void> {
    if (this.platform === 'ipad' || this.platform === 'android_tablet') {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (devices.some(d => d.kind === 'videoinput')) {
          this._status.scanner = { type: 'camera', connected: true, name: 'Camera' };
          return;
        }
      } catch { /* no camera */ }
    }
    this._status.scanner = { type: 'keyboard_wedge', connected: true, name: 'Douchette USB/BT' };
  }

  startBarcodeListener(callback: BarcodeCallback): () => void {
    this.barcodeCallbacks.add(callback);
    if (this._status.scanner.type === 'keyboard_wedge') this.startKeyboardWedgeListener();
    return () => {
      this.barcodeCallbacks.delete(callback);
      if (this.barcodeCallbacks.size === 0) this.stopBarcodeListener();
    };
  }

  private startKeyboardWedgeListener(): void {
    if ((this as any)._keyboardListenerActive) return;
    (this as any)._keyboardListenerActive = true;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'Enter' && this.keyboardBuffer.length >= 4) {
        const code = this.keyboardBuffer;
        this.keyboardBuffer = '';
        const result: BarcodeResult = {
          code,
          format: code.length === 13 ? 'EAN-13' : code.length === 8 ? 'EAN-8' : 'CODE-128',
          timestamp: Date.now(),
        };
        this.barcodeCallbacks.forEach(cb => cb(result));
        e.preventDefault();
        return;
      }

      if (e.key.length === 1) {
        this.keyboardBuffer += e.key;
        if (this.keyboardTimeout) clearTimeout(this.keyboardTimeout);
        this.keyboardTimeout = setTimeout(() => { this.keyboardBuffer = ''; }, 80);
      }
    };

    document.addEventListener('keydown', handler);
    (this as any)._keyboardHandler = handler;
  }

  async startCameraScanner(videoElement: HTMLVideoElement): Promise<boolean> {
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      videoElement.srcObject = this.cameraStream;
      await videoElement.play();

      if ('BarcodeDetector' in window) {
        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code'],
        });
        this.scanInterval = setInterval(async () => {
          try {
            const barcodes = await detector.detect(videoElement);
            if (barcodes.length > 0) {
              const bc = barcodes[0];
              this.barcodeCallbacks.forEach(cb => cb({
                code: bc.rawValue, format: bc.format, timestamp: Date.now(),
              }));
            }
          } catch { /* frame error */ }
        }, 200);
        console.log('[PERIPH] Camera barcode scanner started');
        return true;
      }

      console.warn('[PERIPH] BarcodeDetector API not available');
      return true;
    } catch (e) {
      console.error('[PERIPH] Camera scanner failed:', e);
      return false;
    }
  }

  stopCameraScanner(): void {
    if (this.scanInterval) { clearInterval(this.scanInterval); this.scanInterval = null; }
    if (this.cameraStream) { this.cameraStream.getTracks().forEach(t => t.stop()); this.cameraStream = null; }
  }

  private stopBarcodeListener(): void {
    if ((this as any)._keyboardHandler) {
      document.removeEventListener('keydown', (this as any)._keyboardHandler);
      (this as any)._keyboardListenerActive = false;
    }
    this.stopCameraScanner();
  }

  /* ═══════════════════════════════════════════════
     CASH DRAWER
     ═══════════════════════════════════════════════ */

  private detectCashDrawer(): void {
    // Bluetooth printer-connected drawer works on all platforms (including iPad)
    if (this._status.printer.type === 'thermal_bluetooth') {
      this._status.cashDrawer = { type: 'bluetooth', connected: this._status.printer.connected };
      return;
    }
    // HONESTY (PR #34, même règle que l'impression) : aucun kick tiroir réel
    // n'existe hors du chemin Bluetooth (RJ11 via imprimante BT). Un poste
    // Electron ne « possède » pas un tiroir par optimisme — le statut dit la
    // vérité et le chantier kick USB/spooler reste documenté.
    this._status.cashDrawer = { type: 'none', connected: false };
  }

  /**
   * Kick the cash drawer. Returns TRUE only when a real kick was actually
   * sent (Bluetooth printer RJ11). No connected drawer → honest false — never
   * a fake "pulse sent" success.
   */
  async openCashDrawer(): Promise<boolean> {
    // Try Bluetooth drawer kick first
    if (this._status.cashDrawer.type === 'bluetooth' && this._btDrawerFn) {
      try {
        const result = await this._btDrawerFn();
        if (result) {
          console.log('[PERIPH] Cash drawer opened via Bluetooth');
          return true;
        }
      } catch (e) {
        console.warn('[PERIPH] BT drawer kick failed:', e);
      }
      return false; // real kick attempted and failed — say so
    }

    console.warn('[PERIPH] No cash drawer connected — kick refused (honest)');
    return false;
  }

  /* ── Helpers ── */

  private isElectron(): boolean {
    return typeof window !== 'undefined' &&
      (('electronAPI' in window) || /Electron/i.test(navigator.userAgent));
  }

  private async getElectronPrinters(): Promise<string[]> {
    if ((window as any).electronAPI?.getPrinters) return (window as any).electronAPI.getPrinters();
    return [];
  }

  destroy(): void {
    this.stopBarcodeListener();
    this.barcodeCallbacks.clear();
    console.log('[PERIPH] Bridge destroyed');
  }
}

export const peripheralBridge = new PeripheralBridge();
