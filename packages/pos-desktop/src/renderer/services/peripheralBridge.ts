/**
 * peripheralBridge — Unified peripheral access layer
 *
 * Abstracts hardware access across platforms:
 *  - Windows: USB thermal printers (ESC/POS), cash drawers, barcode scanners
 *  - iPad:    AirPrint, Bluetooth printers, camera barcode scan
 *  - Web:     WebUSB fallback, camera API
 */

import { DevicePlatform } from '../hooks/useDeviceProfile';
import { attachWedgeKeyboardListener } from './wedgeKeyboardListener';
import {
  classifyPrinterMode,
  decideDrawerPath,
  getDrawerQueueName,
  getDrawerStrategy,
  type PrinterCommandMode,
} from './drawerStrategy';

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

/** Driver/port Windows + mode de commande déduit (diagnostic + décision tiroir). */
export interface OsPrinterInfo {
  driverName: string | null;
  portName: string | null;
  mode: PrinterCommandMode;
}

export type PaperWidthMm = 58 | 80;

/** Ventilation TVA d'un ticket (montants en euros, calculés côté caisse). */
export interface TicketVatRow {
  rate: number;
  ht: number;
  tva: number;
  ttc: number;
}

/**
 * Données du ticket papier. TOUT le contenu vient de la configuration du
 * magasin (Dashboard) et de la vente — jamais de valeur codée en dur dans le
 * moteur d'impression. Une donnée absente n'est pas imprimée.
 */
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
    taxRate?: number;
  }>;
  subtotal: number;
  discount: number;
  total: number;
  payments: Array<{ method: string; amount: number }>;
  change: number;
  footer: string;
  nifCaisse: string;
  softwareVersion: string;

  // ── Refonte ticket The Wesley (tous optionnels — config Dashboard) ──
  /** Logo officiel (data-URL PNG/JPEG), imprimé N&B centré. */
  logoDataUrl?: string | null;
  /** CP + ville (2ᵉ ligne d'adresse). */
  addressLine2?: string;
  /** Raison sociale exploitante (si différente de l'enseigne). */
  operatingCompanyName?: string;
  /** RCS (mention légale, imprimée seulement si renseignée). */
  rcs?: string;
  /** Capital social (mention légale, imprimée seulement si renseignée). */
  capitalSocial?: string;
  /** Téléphone du magasin. */
  phone?: string;
  /** Site Internet du magasin. */
  website?: string;
  /** Message d'en-tête personnalisé (Dashboard). */
  headerMessage?: string;
  /** Libellé de la caisse (ex. « Caisse 1 »). */
  registerLabel?: string;
  /** Espèces reçues (paiement espèces) — pour la ligne « Reçu / Rendu ». */
  cashReceived?: number;
  /** Ventilation TVA par taux (HT / TVA / TTC). */
  vat?: TicketVatRow[];
  /** QR code du ticket numérique, PRÉ-généré en data-URL PNG (chemin HTML). */
  qrDataUrl?: string | null;
  /** Contenu encodé dans le QR (URL publique) — pour le QR natif ESC/POS. */
  qrContent?: string | null;
  /** Texte court imprimé près du QR (Dashboard). */
  qrText?: string;
  /** Formule de fin (Dashboard, ex. « Merci et à bientôt chez The Wesley »). */
  finalMessage?: string;
  /** Vente hors ligne : note « ticket numérique disponible après synchro ». */
  offlineNote?: string;
  /** Largeur papier (58 ou 80 mm). Défaut : réglage caisse (80 mm). */
  paperWidthMm?: PaperWidthMm;
  /** Marqueur ticket de test (« TEST — SANS VALEUR FISCALE ») — diagnostics UNIQUEMENT. */
  testMarker?: string;
}

export interface BarcodeResult {
  code: string;
  format: string;
  timestamp: number;
}

type BarcodeCallback = (result: BarcodeResult) => void;

/* ═══════════════════════════════════════════════════
   RÉGLAGE LARGEUR PAPIER (58 / 80 mm)
   ═══════════════════════════════════════════════════ */

const PAPER_WIDTH_KEY = 'caisse_paper_width_mm';

/** Largeur papier configurée pour cette caisse (défaut 80 mm). */
export function getPaperWidthMm(): PaperWidthMm {
  try {
    return localStorage.getItem(PAPER_WIDTH_KEY) === '58' ? 58 : 80;
  } catch {
    return 80;
  }
}

/** Mémorise la largeur papier de cette caisse. */
export function setPaperWidthMm(width: PaperWidthMm): void {
  try {
    localStorage.setItem(PAPER_WIDTH_KEY, String(width));
  } catch { /* ignore */ }
}

/* ═══════════════════════════════════════════════════
   ESC/POS — QR natif + encodage CP1252
   ═══════════════════════════════════════════════════ */

/**
 * Commandes ESC/POS de QR code natif (GS ( k, modèle 2) : taille de module,
 * correction M, stockage des données, impression. `content` = URL publique du
 * ticket — jamais d'identifiant interne ni de donnée client.
 */
export function buildEscposQr(content: string, moduleSize = 6): string {
  const GS = '\x1D';
  const data = content.slice(0, 700); // QR v.moyenne — largement assez pour l'URL
  const storeLen = data.length + 3;
  const pL = String.fromCharCode(storeLen & 0xff);
  const pH = String.fromCharCode((storeLen >> 8) & 0xff);
  return [
    `${GS}(k\x04\x00\x31\x41\x32\x00`, // modèle 2
    `${GS}(k\x03\x00\x31\x43${String.fromCharCode(moduleSize)}`, // taille module
    `${GS}(k\x03\x00\x31\x45\x31`, // correction M
    `${GS}(k${pL}${pH}\x31\x50\x30${data}`, // stockage
    `${GS}(k\x03\x00\x31\x51\x30`, // impression
  ].join('');
}

/**
 * Encode une chaîne de commandes ESC/POS en octets CP1252 (les caractères
 * 0x00-0xFF passent tels quels ; les accents usuels sont mappés ; le reste est
 * translittéré) — jamais d'UTF-8 multi-octets qui produirait du mojibake sur
 * une thermique en page de code Windows-1252 (sélectionnée via ESC t 16).
 */
export function encodeEscpos(commands: string): Uint8Array {
  const CP1252_EXTRA: Record<string, number> = {
    '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92,
    '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, 'œ': 0x9c, 'Œ': 0x8c, 'Ÿ': 0x9f,
  };
  const out: number[] = [];
  for (const ch of commands) {
    const code = ch.codePointAt(0)!;
    if (code <= 0xff) {
      out.push(code); // latin-1 ⊂ CP1252 (accents é è à ç … corrects)
    } else if (CP1252_EXTRA[ch] !== undefined) {
      out.push(CP1252_EXTRA[ch]);
    } else {
      const ascii = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const fallback = ascii.codePointAt(0);
      out.push(fallback !== undefined && fallback <= 0xff ? fallback : 0x3f); // '?'
    }
  }
  return new Uint8Array(out);
}

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
  /** Driver/port/mode de l'imprimante OS sélectionnée (null tant que non lu). */
  private _printerInfo: OsPrinterInfo | null = null;
  /** Derniers chronométrages réels (diagnostic latence terrain). */
  lastPrintTimings: Record<string, number> | null = null;
  lastDrawerTimings: { ms?: number; path?: string } | null = null;
  /** Dernière raison d'échec/refus tiroir (affichée à l'écran diagnostic). */
  lastDrawerError: string | null = null;
  private _btPrintFn: ((data: TicketData) => Promise<boolean>) | null = null;
  private _btDrawerFn: (() => Promise<boolean>) | null = null;
  private cameraStream: MediaStream | null = null;
  private scanInterval: ReturnType<typeof setInterval> | null = null;

  /* ── Init ── */

  async init(platform: DevicePlatform): Promise<PeripheralStatus> {
    this.platform = platform;
    console.log(`[PERIPH] Initializing for platform: ${platform}`);

    // Défaut SYNCHRONE : une douchette USB/BT se comporte comme un clavier, c'est
    // le scanner par défaut de toute caisse. On fixe le type AVANT le moindre
    // `await` pour qu'un `startBarcodeListener` abonné juste après `init()` (effet
    // de montage frère, non-awaité) attache immédiatement l'écoute clavier globale.
    // SANS cela, la détection asynchrone (`detectScanner`, qui sonde une caméra sur
    // tablette) laisse `type='none'` au moment de l'abonnement → aucun écouteur
    // global n'est posé → chaque scan est tapé dans le champ ayant le focus (barre
    // de recherche). C'était la cause racine du P0 « le code-barres s'écrit dans la
    // recherche produit ». `detectScanner` ne fait ensuite qu'UPGRADER une tablette
    // vers la caméra si elle en a une.
    this._status.scanner = { type: 'keyboard_wedge', connected: true, name: 'Douchette USB/BT' };

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
          // Respecte l'imprimante choisie par l'opérateur (persistée) si elle
          // est toujours présente ; sinon la 1ʳᵉ de l'OS.
          const saved = this.getSelectedOsPrinter();
          const name = saved && electronPrinters.includes(saved) ? saved : electronPrinters[0];
          this._status.printer = { type: 'thermal_usb', connected: true, name };
          await this.refreshPrinterInfo(name);
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

  /**
   * Lit le driver/port Windows de l'imprimante et en déduit le MODE RÉEL
   * (ex. TSP100/TSP143 futurePRNT = raster → ESC/POS brut interdit). Jamais
   * bloquant : en cas d'échec, mode 'unknown' (comportement d'avant).
   */
  private async refreshPrinterInfo(name: string): Promise<void> {
    this._printerInfo = null;
    try {
      const api = (window as any).electronAPI;
      if (!api?.getPrinterInfo) return;
      const info = await api.getPrinterInfo(name);
      if (info?.ok) {
        this._printerInfo = {
          driverName: info.driverName ?? null,
          portName: info.portName ?? null,
          mode: classifyPrinterMode(info.driverName),
        };
        console.log('[PERIPH] Printer driver:', info.driverName, '→ mode:', this._printerInfo.mode);
      } else {
        console.warn('[PERIPH] getPrinterInfo failed:', info?.error);
      }
    } catch (e) {
      console.warn('[PERIPH] getPrinterInfo error:', e);
    }
  }

  /** Driver/port/mode de l'imprimante OS (null si non lu — ex. hors desktop). */
  get printerInfo(): OsPrinterInfo | null {
    return this._printerInfo;
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
        const tBuild = Date.now();
        const html = this.buildReceiptHtml(data);
        const buildMs = Date.now() - tBuild;
        // Cible l'imprimante sélectionnée (sinon défaut OS).
        const device = this._status.printer.name ?? undefined;
        const result = await (window as any).electronAPI.printTicketHtml(html, device);
        // Chronométrage réel (main) + construction HTML — pour la trace terrain.
        this.lastPrintTimings = { buildMs, htmlBytes: html.length, ...(result?.timings ?? {}) };
        if (result?.ok) {
          console.log('[PERIPH] Desktop OS print success', JSON.stringify(this.lastPrintTimings));
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
      await device.transferOut(1, encodeEscpos(commands));
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
      const bytes = encodeEscpos(commands);
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

  /**
   * Construit le DOM du ticket papier (58 ou 80 mm). Refonte The Wesley :
   * logo N&B centré, mentions légales dynamiques (champ vide = non imprimé),
   * qté × PU, remises, sous-total, ventilation TVA par taux, TOTAL TTC,
   * reçu/rendu espèces, phrase personnalisée, QR ticket numérique. Tout vient
   * de TicketData (config magasin + vente) — aucune valeur en dur.
   */
  private buildReceiptDOM(doc: Document, data: TicketData): void {
    const width = data.paperWidthMm ?? getPaperWidthMm();
    const bodyMm = width === 58 ? 48 : 72;

    const style = doc.createElement('style');
    style.textContent = `
      @page { size: ${width}mm auto; margin: 0; }
      :root { color-scheme: light; }
      body { font-family: 'Courier New', monospace; font-size: ${width === 58 ? 10 : 12}px; width: ${bodyMm}mm; margin: 3mm auto; color: #000; background: #fff; }
      .center { text-align: center; }
      .bold { font-weight: bold; }
      .small { font-size: ${width === 58 ? 8 : 9}px; }
      .line { border-top: 1px dashed #000; margin: 4px 0; }
      table { width: 100%; border-collapse: collapse; }
      td, th { padding: 1px 0; font-size: ${width === 58 ? 9 : 11}px; }
      th { text-align: right; font-weight: bold; border-bottom: 1px solid #000; }
      th:first-child { text-align: left; }
      .row { display: flex; justify-content: space-between; }
      .logo { display: block; margin: 0 auto 2mm; max-width: ${width === 58 ? 34 : 46}mm; max-height: 18mm; filter: grayscale(100%) contrast(160%); }
      .qr { display: block; margin: 2mm auto 1mm; width: ${width === 58 ? 22 : 26}mm; height: ${width === 58 ? 22 : 26}mm; }
      .total-line { display: flex; justify-content: space-between; font-weight: bold; font-size: ${width === 58 ? 13 : 16}px; }
      .wrap { word-break: break-word; }
    `;
    doc.head.appendChild(style);

    const body = doc.body;
    const el = (tag: string, className: string, text?: string, fontSize?: string) => {
      const d = doc.createElement(tag);
      if (className) d.className = className;
      if (text !== undefined) d.textContent = text;
      if (fontSize) (d as HTMLElement).style.fontSize = fontSize;
      return d as HTMLElement;
    };
    const rowOf = (label: string, value: string, cls = 'row') => {
      const r = el('div', cls);
      r.appendChild(el('span', '', label));
      r.appendChild(el('span', '', value));
      return r;
    };
    const eur = (n: number) => `${n.toFixed(2)} EUR`;

    // ── Marqueur TEST (diagnostics uniquement — jamais sur une vente réelle) ──
    if (data.testMarker) {
      body.appendChild(el('div', 'center bold', `*** ${data.testMarker} ***`));
      body.appendChild(this.makeLine(doc));
    }

    // ── Logo officiel (config Dashboard), N&B, centré ──
    if (data.logoDataUrl && /^data:image\/(png|jpe?g);base64,/.test(data.logoDataUrl)) {
      const img = doc.createElement('img');
      img.className = 'logo';
      img.src = data.logoDataUrl;
      img.alt = data.storeName;
      body.appendChild(img);
    }

    // ── Enseigne + identité ──
    body.appendChild(el('div', 'center bold wrap', data.storeName, width === 58 ? '12px' : '14px'));
    if (data.operatingCompanyName && data.operatingCompanyName !== data.storeName) {
      body.appendChild(el('div', 'center small wrap', data.operatingCompanyName));
    }
    if (data.storeAddress) body.appendChild(el('div', 'center small wrap', data.storeAddress));
    if (data.addressLine2) body.appendChild(el('div', 'center small wrap', data.addressLine2));
    const contact = [data.phone, data.website].filter(Boolean).join(' - ');
    if (contact) body.appendChild(el('div', 'center small wrap', contact));

    // ── Mentions légales : seulement les champs renseignés ──
    const legalBits: string[] = [];
    if (data.siret) legalBits.push(`SIRET ${data.siret}`);
    if (data.rcs) legalBits.push(`RCS ${data.rcs}`);
    if (data.tvaIntracom) legalBits.push(`TVA ${data.tvaIntracom}`);
    if (data.capitalSocial) legalBits.push(`Capital ${data.capitalSocial}`);
    if (legalBits.length) body.appendChild(el('div', 'center small wrap', legalBits.join(' - ')));

    if (data.headerMessage) body.appendChild(el('div', 'center small wrap', data.headerMessage));

    body.appendChild(this.makeLine(doc));

    // ── Infos ticket ──
    body.appendChild(el('div', 'bold', `Ticket ${data.ticketNumber}`));
    body.appendChild(el('div', '', `Date: ${data.date}`));
    if (data.registerLabel) body.appendChild(el('div', '', `Caisse: ${data.registerLabel}`));
    body.appendChild(el('div', '', `Vendeur: ${data.cashierName}`));

    body.appendChild(this.makeLine(doc));

    // ── Articles : nom, puis qté × PU + remise + total ligne ──
    for (const item of data.items) {
      body.appendChild(el('div', 'wrap', item.name));
      const detail = rowOf(`  ${item.quantity} x ${item.unitPrice.toFixed(2)}`, eur(item.total));
      body.appendChild(detail);
      if (item.discount && item.discount > 0) {
        body.appendChild(el('div', 'small', `  Remise: -${item.discount.toFixed(2)} EUR`));
      }
    }

    body.appendChild(this.makeLine(doc));

    // ── Totaux ──
    body.appendChild(rowOf('Sous-total', eur(data.subtotal)));
    if (data.discount > 0) body.appendChild(rowOf('Remises', `-${data.discount.toFixed(2)} EUR`));
    const totalRow = el('div', 'total-line');
    totalRow.appendChild(el('span', '', 'TOTAL TTC'));
    totalRow.appendChild(el('span', '', eur(data.total)));
    body.appendChild(totalRow);

    // ── Ventilation TVA par taux ──
    if (data.vat && data.vat.length > 0) {
      const table = doc.createElement('table');
      const head = doc.createElement('tr');
      for (const t of ['Taux', 'HT', 'TVA', 'TTC']) {
        const th = doc.createElement('th');
        th.textContent = t;
        head.appendChild(th);
      }
      table.appendChild(head);
      for (const v of data.vat) {
        const tr = doc.createElement('tr');
        const cells = [
          `${Number.isInteger(v.rate) ? v.rate : v.rate.toFixed(2).replace(/\.?0+$/, '')}%`,
          v.ht.toFixed(2),
          v.tva.toFixed(2),
          v.ttc.toFixed(2),
        ];
        cells.forEach((c, i) => {
          const td = doc.createElement('td');
          td.style.textAlign = i === 0 ? 'left' : 'right';
          td.textContent = c;
          tr.appendChild(td);
        });
        table.appendChild(tr);
      }
      body.appendChild(table);
    }

    body.appendChild(this.makeLine(doc));

    // ── Paiements + reçu/rendu espèces ──
    for (const p of data.payments) body.appendChild(rowOf(p.method, eur(p.amount)));
    if (data.cashReceived && data.cashReceived > 0) body.appendChild(rowOf('Recu', eur(data.cashReceived)));
    if (data.change > 0) body.appendChild(rowOf('Rendu', eur(data.change)));

    body.appendChild(this.makeLine(doc));

    // ── Phrase personnalisée (Dashboard) ──
    if (data.footer) body.appendChild(el('div', 'center wrap', data.footer, width === 58 ? '9px' : '10px'));

    // ── QR ticket numérique (ou note hors ligne) ──
    if (data.qrDataUrl) {
      const qr = doc.createElement('img');
      qr.className = 'qr';
      qr.src = data.qrDataUrl;
      qr.alt = 'QR ticket';
      body.appendChild(qr);
      if (data.qrText) body.appendChild(el('div', 'center small wrap', data.qrText));
    } else if (data.offlineNote) {
      body.appendChild(el('div', 'center small wrap', data.offlineNote));
    }

    // ── Formule de fin (Dashboard) ──
    if (data.finalMessage) body.appendChild(el('div', 'center bold wrap', data.finalMessage, width === 58 ? '10px' : '11px'));

    // ── Mentions caisse (NF525) ──
    const tech: string[] = [];
    if (data.nifCaisse) tech.push(`NIF: ${data.nifCaisse}`);
    if (data.softwareVersion) tech.push(`v${data.softwareVersion}`);
    if (tech.length) body.appendChild(el('div', 'center small', tech.join(' | ')));
  }

  private makeLine(doc: Document): HTMLDivElement {
    const d = doc.createElement('div');
    d.className = 'line';
    return d;
  }

  /**
   * Ticket ESC/POS brut (chemins WebUSB / Bluetooth). Même contenu que le
   * template HTML : mentions dynamiques, qté × PU, ventilation TVA, TOTAL TTC,
   * QR natif (GS ( k). Le logo bitmap n'est pas rasterisé sur ce chemin de
   * secours — le chemin principal (impression HTML) l'imprime. Encodage :
   * CP1252 via encodeEscpos (accents corrects, jamais d'UTF-8 mojibake).
   */
  private buildESCPOSCommands(data: TicketData): string {
    const ESC = '\x1B';
    const GS = '\x1D';
    const width = data.paperWidthMm ?? getPaperWidthMm();
    const cols = width === 58 ? 32 : 48;
    const sep = '-'.repeat(cols);
    const pad = (left: string, right: string) => {
      const space = Math.max(1, cols - left.length - right.length);
      return left + ' '.repeat(space) + right;
    };
    const eur = (n: number) => `${n.toFixed(2)} EUR`;

    const lines: string[] = [];
    lines.push(`${ESC}@`);
    lines.push(`${ESC}t\x10`); // codepage WPC1252 (accents)
    lines.push(`${ESC}a\x01`); // centre

    if (data.testMarker) {
      lines.push(`${ESC}E\x01*** ${data.testMarker} ***${ESC}E\x00`);
      lines.push(sep);
    }

    lines.push(`${ESC}E\x01${data.storeName}${ESC}E\x00`);
    if (data.operatingCompanyName && data.operatingCompanyName !== data.storeName) {
      lines.push(data.operatingCompanyName);
    }
    if (data.storeAddress) lines.push(data.storeAddress);
    if (data.addressLine2) lines.push(data.addressLine2);
    const contact = [data.phone, data.website].filter(Boolean).join(' - ');
    if (contact) lines.push(contact);
    if (data.siret) lines.push(`SIRET ${data.siret}`);
    if (data.rcs) lines.push(`RCS ${data.rcs}`);
    if (data.tvaIntracom) lines.push(`TVA ${data.tvaIntracom}`);
    if (data.capitalSocial) lines.push(`Capital ${data.capitalSocial}`);
    if (data.headerMessage) lines.push(data.headerMessage);
    lines.push('');
    lines.push(`${ESC}a\x00`); // gauche
    lines.push(`${ESC}E\x01Ticket ${data.ticketNumber}${ESC}E\x00`);
    lines.push(`Date: ${data.date}`);
    if (data.registerLabel) lines.push(`Caisse: ${data.registerLabel}`);
    lines.push(`Vendeur: ${data.cashierName}`);
    lines.push(sep);
    for (const item of data.items) {
      lines.push(item.name.slice(0, cols));
      lines.push(pad(`  ${item.quantity} x ${item.unitPrice.toFixed(2)}`, eur(item.total)));
      if (item.discount && item.discount > 0) lines.push(`  Remise: -${item.discount.toFixed(2)} EUR`);
    }
    lines.push(sep);
    lines.push(pad('Sous-total', eur(data.subtotal)));
    if (data.discount > 0) lines.push(pad('Remises', `-${data.discount.toFixed(2)} EUR`));
    lines.push(`${ESC}E\x01${GS}!\x01${pad('TOTAL TTC', eur(data.total))}${GS}!\x00${ESC}E\x00`);
    if (data.vat && data.vat.length > 0) {
      lines.push('');
      lines.push(pad('Taux', 'HT     TVA     TTC'));
      for (const v of data.vat) {
        const rate = `${Number.isInteger(v.rate) ? v.rate : v.rate.toFixed(2).replace(/\.?0+$/, '')}%`;
        lines.push(pad(rate, `${v.ht.toFixed(2)}  ${v.tva.toFixed(2)}  ${v.ttc.toFixed(2)}`));
      }
    }
    lines.push(sep);
    for (const p of data.payments) lines.push(pad(p.method, eur(p.amount)));
    if (data.cashReceived && data.cashReceived > 0) lines.push(pad('Recu', eur(data.cashReceived)));
    if (data.change > 0) lines.push(pad('Rendu', eur(data.change)));
    lines.push(sep);
    lines.push(`${ESC}a\x01`); // centre
    if (data.footer) lines.push(data.footer);

    // ── QR natif ESC/POS (GS ( k) — ticket numérique ──
    if (data.qrContent) {
      lines.push(buildEscposQr(data.qrContent, width === 58 ? 5 : 6));
      if (data.qrText) lines.push(data.qrText);
    } else if (data.offlineNote) {
      lines.push(data.offlineNote);
    }

    if (data.finalMessage) lines.push(`${ESC}E\x01${data.finalMessage}${ESC}E\x00`);
    const tech: string[] = [];
    if (data.nifCaisse) tech.push(`NIF: ${data.nifCaisse}`);
    if (data.softwareVersion) tech.push(`v${data.softwareVersion}`);
    if (tech.length) lines.push(tech.join(' | '));
    lines.push('');
    lines.push(`${GS}V\x00`);
    return lines.join('\n');
  }

  /* ═══════════════════════════════════════════════
     BARCODE SCANNER
     ═══════════════════════════════════════════════ */

  private async detectScanner(): Promise<void> {
    // Le défaut keyboard_wedge est déjà posé SYNCHRONEMENT dans init(). Ici on ne
    // fait qu'UPGRADER une tablette équipée d'une caméra vers le scan caméra — et,
    // dans ce cas seulement, on retire l'écoute clavier globale déjà attachée (la
    // caméra remplace la douchette sur ce poste, pas de double chemin).
    if (this.platform === 'ipad' || this.platform === 'android_tablet') {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (devices.some(d => d.kind === 'videoinput')) {
          this._status.scanner = { type: 'camera', connected: true, name: 'Camera' };
          if ((this as any)._keyboardListenerActive) this.stopKeyboardWedgeListener();
          return;
        }
      } catch { /* no camera */ }
    }
    // Reste en keyboard_wedge. Belt-and-suspenders : si un abonnement a eu lieu
    // AVANT la fin de la détection (course d'init), l'écoute clavier peut ne pas
    // être encore active — on l'attache maintenant que le type est confirmé.
    this._status.scanner = { type: 'keyboard_wedge', connected: true, name: 'Douchette USB/BT' };
    if (this.barcodeCallbacks.size > 0) this.startKeyboardWedgeListener();
  }

  startBarcodeListener(callback: BarcodeCallback): () => void {
    this.barcodeCallbacks.add(callback);
    // Attache l'écoute clavier globale dès que le scanner PEUT être une douchette
    // (tout sauf une tablette confirmée en mode caméra). Ne JAMAIS conditionner
    // cette attache au seul résultat asynchrone de detectScanner : la course
    // laisserait la caisse desktop sans écouteur et les scans fuiraient dans le
    // champ ayant le focus (P0). Sur tablette-caméra, detectScanner détache.
    if (this._status.scanner.type !== 'camera') this.startKeyboardWedgeListener();
    return () => {
      this.barcodeCallbacks.delete(callback);
      if (this.barcodeCallbacks.size === 0) this.stopBarcodeListener();
    };
  }

  private startKeyboardWedgeListener(): void {
    if ((this as any)._keyboardListenerActive) return;
    (this as any)._keyboardListenerActive = true;

    // Écoute clavier globale (phase de capture) — cf. wedgeKeyboardListener.ts :
    // avale la rafale reconnue (le code n'est jamais laissé dans un champ), route au
    // panier, préserve la frappe humaine. Testé au niveau DOM (wedgeKeyboardListener.dom.test).
    (this as any)._keyboardDetach = attachWedgeKeyboardListener(document, (b) => {
      const result: BarcodeResult = { code: b.code, format: b.format, timestamp: Date.now() };
      this.barcodeCallbacks.forEach(cb => cb(result));
    });
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

  private stopKeyboardWedgeListener(): void {
    if ((this as any)._keyboardDetach) {
      (this as any)._keyboardDetach();
      (this as any)._keyboardDetach = null;
    }
    (this as any)._keyboardListenerActive = false;
  }

  private stopBarcodeListener(): void {
    this.stopKeyboardWedgeListener();
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
    // Desktop Windows : le tiroir est branché sur l'imprimante thermique USB.
    // On envoie le kick ESC/POS via un job RAW au spooler (posRawPrint). Le
    // statut est « prêt » dès qu'une imprimante OS est détectée ; le succès
    // réel du kick reste honnête (résultat du job RAW), jamais optimiste.
    if (this._status.printer.type === 'thermal_usb' && this.isElectron() && (window as any).electronAPI?.openCashDrawer) {
      this._status.cashDrawer = { type: 'printer_kick', connected: true };
      return;
    }
    // Sinon : pas de tiroir réel — le statut dit la vérité.
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

    // Desktop Windows : le CHEMIN dépend du MODE RÉEL du driver (décision pure
    // `decideDrawerPath`) : 'raw' = kick ESC/POS (imprimantes ESC/POS) ;
    // 'queue' = job driver vers la file Windows dédiée (TSP100/TSP143
    // futurePRNT raster — l'ESC/POS brut y est inopérant et peut corrompre les
    // jobs d'impression) ; 'refuse' = échec honnête expliqué, JAMAIS d'octets
    // aveugles vers le matériel (incident « tiroir en boucle »).
    if (this._status.cashDrawer.type === 'printer_kick' && (window as any).electronAPI?.openCashDrawer) {
      this.lastDrawerError = null;
      const mode = this._printerInfo?.mode ?? 'unknown';
      const decision = decideDrawerPath(mode, getDrawerStrategy(), getDrawerQueueName());
      if (decision.path === 'refuse') {
        this.lastDrawerError = decision.reason;
        this.lastDrawerTimings = { path: 'refuse' };
        console.warn('[PERIPH] Drawer kick refused (honest):', decision.reason);
        return false;
      }
      try {
        const device = this._status.printer.name ?? undefined;
        const opts =
          decision.path === 'queue'
            ? { path: 'queue' as const, queueName: decision.queueName }
            : { path: 'raw' as const };
        const res = await (window as any).electronAPI.openCashDrawer(device, opts);
        this.lastDrawerTimings = { ms: res?.ms, path: decision.path };
        if (res?.ok) {
          console.log(`[PERIPH] Cash drawer opened via ${decision.path} (${res?.ms ?? '?'}ms)`);
          return true;
        }
        this.lastDrawerError = res?.error || 'échec ouverture tiroir';
        console.warn('[PERIPH] Drawer kick failed:', decision.path, res?.error);
      } catch (e) {
        this.lastDrawerError = e instanceof Error ? e.message : String(e);
        console.warn('[PERIPH] Drawer kick error:', e);
      }
      return false; // vrai kick tenté et échoué — on le dit
    }

    console.warn('[PERIPH] No cash drawer connected — kick refused (honest)');
    return false;
  }

  /** Imprimante OS choisie par l'opérateur (persistée), ou null. */
  getSelectedOsPrinter(): string | null {
    try {
      return localStorage.getItem('caisse_os_printer');
    } catch {
      return null;
    }
  }

  /** Mémorise l'imprimante OS choisie puis redétecte (nom + tiroir). */
  async setSelectedOsPrinter(name: string | null): Promise<void> {
    try {
      if (name) localStorage.setItem('caisse_os_printer', name);
      else localStorage.removeItem('caisse_os_printer');
    } catch { /* ignore */ }
    await this.detectPrinter();
    this.detectCashDrawer();
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
