import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, User, ShoppingBag, CreditCard, Banknote, Layers,
  Minus, Plus, X, ChevronDown, LogOut, CheckCircle2,
  ScanBarcode, UserCircle, Weight, Tag, ArrowRight,
  FileText, Smartphone, XCircle, Clock, Trash2, Coins, Split,
  History, RotateCcw, Printer, Receipt, AlertTriangle,
  Camera, Pause, Maximize2, Minimize2, Share, Download, QrCode, Ticket, Gift, Users,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { usePOSStore } from '../../stores/posStore';
import { useDeviceProfile, platformClasses } from '../../hooks/useDeviceProfile';
import { useCart, CatalogueProduct } from '../../hooks/useCart';
import { usePayment, PaymentMethod } from '../../hooks/usePayment';
import { useFavorites } from '../../hooks/useFavorites';
import { useOfflineMode } from '../../hooks/useOfflineMode';
import { useRights } from '../../hooks/useRights';
import { FluxWidget } from '../FluxWidget';
import { ShiftIndicator } from '../ShiftIndicator';
import { StaffingWidget } from '../StaffingWidget';
import { ComparisonWidget } from '../ComparisonWidget';
import { ShiftWarning } from '../ShiftWarning';
import { SalesCockpit } from '../SalesCockpit';
import { AiRecommendation } from '../AiRecommendation';
import { CategoryPanel } from './CategoryPanel';
import { ProductGrid } from './ProductGrid';
import { FavoritesBar } from './FavoritesBar';
import { SuspendedTicketsDrawer } from './SuspendedTicketsDrawer';
import { ScannerTool } from './ScannerTool';
import { PrinterSettings } from './PrinterSettings';
import { useTicketHistory } from '../../hooks/useTicketHistory';
import { TicketHistoryModal } from '../pos/TicketHistoryModal';
import { AvoirTenderModal } from '../pos/AvoirTenderModal';
import { useBluetoothPrinter } from '../../hooks/useBluetoothPrinter';
import { peripheralBridge } from '../../services/peripheralBridge';
import { ActiveCashierBanner } from '../ActiveCashierBanner';
import { ScoreDetailModal } from '../ScoreDetailModal';
import { CashCountModal } from '../pos/CashCountModal';
import { CashOpenModal } from '../pos/CashOpenModal';
import { Wifi, WifiOff, CloudOff, Cloud, RefreshCw as SyncIcon, ShieldAlert, Upload, Lock as LockIcon } from 'lucide-react';

/* ── Helpers ── */

function formatPrice(minorUnits: number) {
  return (minorUnits / 100).toFixed(2).replace('.', ',') + ' \u20ac';
}

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

const avatarColors = [
  'from-rose-100 to-rose-200 text-rose-600',
  'from-blue-100 to-blue-200 text-blue-600',
  'from-amber-100 to-amber-200 text-amber-600',
  'from-emerald-100 to-emerald-200 text-emerald-600',
  'from-violet-100 to-violet-200 text-violet-600',
  'from-cyan-100 to-cyan-200 text-cyan-600',
  'from-pink-100 to-pink-200 text-pink-600',
  'from-lime-100 to-lime-200 text-lime-600',
];
function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

const methodLabel = (m: string) => {
  if (m === 'card') return 'Carte Bancaire';
  if (m === 'cash') return 'Especes';
  return 'Paiement Mixte';
};

/* ── Component ── */

export function IPadPOSLayout() {
  const store = usePOSStore();
  const device = useDeviceProfile();
  const cart = useCart();
  const payment = usePayment();
  const favorites = useFavorites();
  const offlineMode = useOfflineMode();
  const rights = useRights();
  const ticketHistory = useTicketHistory();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [suspendedOpen, setSuspendedOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);
  const [avoirOpen, setAvoirOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [scoreDetailOpen, setScoreDetailOpen] = useState(false);
  const btPrinter = useBluetoothPrinter();

  // Sync BT printer status with peripheralBridge
  useEffect(() => {
    if (btPrinter.status === 'connected' && btPrinter.printer) {
      peripheralBridge.updateBluetoothPrinterStatus(true, btPrinter.printer.name);
      peripheralBridge.registerBluetoothPrinter(btPrinter.printTicket, btPrinter.openCashDrawer);
    } else {
      peripheralBridge.updateBluetoothPrinterStatus(false, null);
    }
  }, [btPrinter.status, btPrinter.printer, btPrinter.printTicket, btPrinter.openCashDrawer]);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [digitalReceipt, setDigitalReceipt] = useState<{
    ticketNumber: string; total: number; items: number; date: string; cashier: string; receiptUrl: string;
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Show install banner if on iPad Safari but NOT in PWA standalone mode
  useEffect(() => {
    if (device.isIPad && !device.isPWA) {
      // Check if user already dismissed
      const dismissed = localStorage.getItem('caisse_install_dismissed');
      if (!dismissed) {
        setShowInstallBanner(true);
      }
    }
  }, [device.isIPad, device.isPWA]);

  // Add to favorites when adding to cart
  const handleAddProduct = useCallback((product: CatalogueProduct) => {
    cart.handleSelectProduct(product);
    favorites.addRecent({
      productId: product.id,
      name: product.name,
      ean: product.ean,
      priceMinorUnits: product.priceMinorUnits,
      categoryId: product.categoryId,
    });
  }, [cart, favorites]);

  // Handle favorite selection
  const handleFavoriteSelect = useCallback((productId: string) => {
    const product = cart.catalogue.find((p) => p.id === productId);
    if (product) handleAddProduct(product);
  }, [cart.catalogue, handleAddProduct]);

  // Handle scanner result (from camera, bluetooth, or manual entry)
  const handleScannerResult = useCallback((code: string, format: string) => {
    cart.handleScan(code);
  }, [cart]);

  const isLandscape = device.isLandscape;

  // ── Safety escape: if confirmation overlay gets stuck, auto-dismiss after 30s ──
  useEffect(() => {
    if (!payment.confirmation) return;
    const safetyTimeout = setTimeout(() => {
      console.warn('[POS] Safety: force-dismissing stuck confirmation overlay after 30s');
      payment.completeTransaction();
    }, 30_000);
    return () => clearTimeout(safetyTimeout);
  }, [payment.confirmation]);

  return (
    <div className={`h-[100dvh] flex flex-col bg-pos-bg safe-area-top safe-area-bottom overflow-x-hidden ${platformClasses(device)}`}>
      {/* ═══ INSTALL PWA BANNER — shown in Safari, hidden in standalone mode ═══ */}
      {showInstallBanner && (
        <div className="bg-gradient-to-r from-pos-accent via-pink-500 to-rose-500 px-4 py-3 flex items-center justify-between relative z-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Download size={20} className="text-white" />
            </div>
            <div>
              <p className="text-white text-sm font-bold">Installer la caisse en plein ecran</p>
              <p className="text-white/80 text-xs">
                Tap <Share size={12} className="inline text-white" /> Partager → "Sur l'ecran d'accueil"
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setShowInstallBanner(false);
              localStorage.setItem('caisse_install_dismissed', '1');
            }}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* ═══ OFFLINE BANNER ═══ */}
      {offlineMode.isOffline && (
        <div className="bg-gradient-to-r from-red-600 via-red-500 to-rose-500 px-4 py-1.5 flex items-center justify-between relative z-50">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-white/15 rounded-lg px-2 py-0.5">
              <WifiOff size={12} className="text-white animate-pulse" />
              <span className="text-white text-[11px] font-black uppercase">Offline</span>
            </div>
            <span className="text-white/80 text-[11px]">Ventes enregistrees localement</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 bg-white/15 rounded-lg px-2 py-0.5 text-white text-[11px] font-bold">
              <Upload size={10} />
              {offlineMode.pendingCount} en attente
            </span>
          </div>
        </div>
      )}

      {!fullscreen && <ShiftWarning />}

      {/* ═══ HEADER — hidden in fullscreen mode ═══ */}
      {!fullscreen && (
        <header className={`pos-header-ipad bg-white/95 backdrop-blur-xl border-b border-pos-border/20 flex items-center justify-between z-30 ${isLandscape ? 'px-3 py-1.5' : 'px-3 py-2'}`}>
          <div className="flex items-center gap-2 min-w-0">
            {/* Logo */}
            <div className={`${isLandscape ? 'w-7 h-7' : 'w-8 h-8'} rounded-xl bg-pos-text flex items-center justify-center flex-shrink-0`}>
              <span className="text-white font-black text-xs">C</span>
            </div>

            {/* Caissier actif — bloc VISIBLE EN PERMANENCE (impossible à rater) */}
            <ActiveCashierBanner compact onScoreClick={() => setScoreDetailOpen(true)} />

            {/* Network status — icon only in landscape */}
            <button
              onClick={() => !offlineMode.isOffline && offlineMode.triggerManualSync()}
              className={`flex items-center gap-1 font-bold rounded-full transition-all ${
                isLandscape ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1'
              } ${
                offlineMode.isOffline ? 'bg-red-50 text-red-600 ring-1 ring-red-200 animate-pulse'
                : 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'
              }`}
            >
              {offlineMode.isOffline ? <WifiOff size={isLandscape ? 9 : 10} /> : <Wifi size={isLandscape ? 9 : 10} />}
              {!isLandscape && (offlineMode.isOffline ? 'OFFLINE' : 'ONLINE')}
            </button>

            {/* Widgets — hide verbose ones in landscape */}
            {!isLandscape && (
              <>
                <FluxWidget occupancy={store.occupancy} weather={store.weather} />
                <ShiftIndicator />
                <StaffingWidget />
                <ComparisonWidget />
              </>
            )}

            {isLandscape && (
              <ShiftIndicator />
            )}

            {payment.lastTransactionTime !== null && (
              <span className={`flex items-center gap-1 font-semibold text-pos-muted bg-pos-subtle rounded-full ${isLandscape ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1'}`}>
                <Clock size={isLandscape ? 9 : 10} />{payment.lastTransactionTime}s
              </span>
            )}
          </div>

          <div className={`flex items-center ${isLandscape ? 'gap-1' : 'gap-1.5'}`}>
            {/* Suspended tickets button */}
            <button
              onClick={() => setSuspendedOpen(true)}
              className={`relative flex items-center justify-center rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors border border-amber-200 product-card-touch ${
                isLandscape ? 'w-9 h-9' : 'gap-1 text-[11px] font-semibold px-2.5 py-2'
              }`}
            >
              <Pause size={isLandscape ? 15 : 14} />
              {store.suspendedTickets.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center text-[10px] font-black bg-amber-500 text-white rounded-full">
                  {store.suspendedTickets.length}
                </span>
              )}
            </button>

            {/* Scanner tool (camera + bluetooth) */}
            <button
              onClick={() => setScannerOpen(true)}
              className={`flex items-center justify-center rounded-full bg-violet-50 text-violet-600 hover:bg-violet-100 transition-colors border border-violet-200 product-card-touch ${
                isLandscape ? 'w-9 h-9' : 'gap-1 text-[11px] font-semibold px-2.5 py-2'
              }`}
              title="Scanner (Camera & Bluetooth)"
            >
              <ScanBarcode size={isLandscape ? 15 : 14} />
            </button>

            {/* Printer & Cash Drawer settings */}
            <button
              onClick={() => setPrinterSettingsOpen(true)}
              className={`relative flex items-center justify-center rounded-full transition-colors border product-card-touch ${
                btPrinter.status === 'connected'
                  ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-200'
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100 border-gray-200'
              } ${isLandscape ? 'w-9 h-9' : 'gap-1 text-[11px] font-semibold px-2.5 py-2'}`}
              title="Imprimante & Tiroir-caisse"
            >
              <Printer size={isLandscape ? 15 : 14} />
              {btPrinter.status === 'connected' && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white" />
              )}
            </button>

            {/* History */}
            <button
              onClick={() => ticketHistory.openHistory()}
              className={`flex items-center justify-center rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors border border-indigo-100 product-card-touch ${
                isLandscape ? 'w-9 h-9' : 'gap-1 text-[11px] font-semibold px-2.5 py-2'
              }`}
            >
              <History size={isLandscape ? 15 : 14} />
            </button>

            {/* Fullscreen toggle */}
            <button
              onClick={() => setFullscreen(true)}
              className={`flex items-center justify-center rounded-full bg-pos-subtle text-pos-muted hover:bg-pos-border/40 transition-colors product-card-touch ${
                isLandscape ? 'w-9 h-9' : 'w-9 h-9'
              }`}
              title="Plein ecran"
            >
              <Maximize2 size={15} />
            </button>

            {/* Profile */}
            <div className="relative">
              <button className="flex items-center gap-1 product-card-touch" onClick={() => setProfileOpen(!profileOpen)}>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pos-accent/20 to-pos-accent-alt/20 flex items-center justify-center">
                  <UserCircle size={18} className="text-pos-text" />
                </div>
              </button>
              {profileOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-elevated border border-pos-border/30 p-2 z-50">
                    <div className="px-3 py-2 border-b border-pos-border/30 mb-1">
                      <p className="text-sm font-semibold">{store.employee?.firstName} {store.employee?.lastName}</p>
                      <p className="text-xs text-pos-muted capitalize">{store.employee?.role}</p>
                    </div>
                    {/* Changer de caissier — verrouille + demande le PIN du nouveau */}
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-pos-text rounded-xl hover:bg-pos-subtle transition-colors"
                      onClick={() => { store.requestLock(true); setProfileOpen(false); }}
                    >
                      <Users size={14} /> Changer de caissier
                    </button>
                    {/* Fermer ma caisse : ouvre la modale de comptage (le comptage
                        collecte le compté ; l'attendu/écart sont calculés serveur). */}
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-pos-danger rounded-xl hover:bg-pos-danger/5 transition-colors"
                      onClick={() => {
                        store.openCashCount();
                        setProfileOpen(false);
                      }}
                    >
                      <LogOut size={14} /> Fermer ma caisse
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
      )}

      {/* ═══ FULLSCREEN: cashier banner stays visible (impossible à rater) ═══ */}
      {fullscreen && (
        <>
          <div className="fixed top-3 left-3 z-50">
            <ActiveCashierBanner compact onScoreClick={() => setScoreDetailOpen(true)} />
          </div>
          <button
            onClick={() => setFullscreen(false)}
            className="fixed top-3 right-3 z-50 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/60 transition-all product-card-touch shadow-lg"
            title="Quitter le plein ecran"
          >
            <Minimize2 size={16} />
          </button>
        </>
      )}

      {/* Détail du score (au clic sur le score du bandeau) */}
      {scoreDetailOpen && <ScoreDetailModal onClose={() => setScoreDetailOpen(false)} />}
      <CashOpenModal />
      <CashCountModal />

      {/* ═══ MAIN 3-COLUMN LAYOUT ═══ */}
      <div className={`flex-1 min-h-0 ${isLandscape ? 'ipad-pos-grid' : 'ipad-pos-grid-portrait'}`}>
        {/* ── LEFT: Categories ── */}
        <CategoryPanel
          categories={cart.categories}
          selected={selectedCategory}
          onSelect={setSelectedCategory}
          orientation={isLandscape ? 'vertical' : 'horizontal'}
        />

        {/* ── CENTER: Search + Scanner + Favorites + Product Grid ── */}
        <div className="flex flex-col min-h-0 min-w-0 overflow-x-hidden bg-pos-bg relative">
          {/* Search bar — compact in landscape */}
          <div className={`px-3 ${isLandscape ? 'pt-2 pb-0.5' : 'pt-3 pb-1'}`}>
            <div className="relative">
              <Search size={isLandscape ? 16 : 18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-pos-muted/40" />
              <input
                ref={searchInputRef}
                type="text"
                className={`w-full pl-10 pr-4 rounded-xl border border-pos-border/30 bg-white focus:outline-none focus:ring-2 focus:ring-pos-accent/30 focus:border-pos-accent transition-all ${
                  isLandscape ? 'py-2.5 text-sm' : 'py-3 text-base'
                }`}
                placeholder="Rechercher un produit..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full hover:bg-pos-subtle"
                >
                  <X size={14} className="text-pos-muted" />
                </button>
              )}
            </div>
          </div>

          {/* ── Inline scanner — sits between search & product grid ── */}
          <ScannerTool
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onScan={handleScannerResult}
            isLandscape={isLandscape}
          />

          {/* Printer & Cash Drawer settings modal */}
          <PrinterSettings
            open={printerSettingsOpen}
            onClose={() => setPrinterSettingsOpen(false)}
          />

          {/* Favorites bar */}
          <FavoritesBar
            favorites={favorites.favorites}
            onSelect={handleFavoriteSelect}
            onToggleFavorite={favorites.toggleFavorite}
          />

          {/* Product grid */}
          <ProductGrid
            products={cart.catalogue}
            category={selectedCategory}
            searchTerm={searchTerm}
            onAdd={handleAddProduct}
            isLandscape={isLandscape}
          />
        </div>

        {/* ── RIGHT: Cart + Summary ── */}
        <div className="flex flex-col bg-white border-l border-pos-border/20 min-h-0">
          {/* Cart header — article count */}
          <div className={`flex items-center justify-between border-b border-pos-border/15 ${isLandscape ? 'px-3 py-1.5' : 'px-3 py-2'}`}>
            <div className="flex items-center gap-1.5">
              <ShoppingBag size={14} className="text-pos-muted" />
              <span className="text-xs font-bold text-pos-muted uppercase tracking-wider">Panier</span>
            </div>
            <span className="text-xs font-bold text-pos-accent bg-pos-accent/10 px-2 py-0.5 rounded-full">
              {store.cartItems.reduce((s, i) => s + i.quantity, 0)}
            </span>
          </div>

          {/* Customer badge */}
          {store.customer && (
            <div className="px-3 py-1.5 border-b border-pos-border/15 bg-gradient-to-r from-violet-50 to-purple-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User size={13} className="text-violet-600" />
                  <span className="text-xs font-semibold">{store.customer.firstName} {store.customer.lastName}</span>
                  <span className="text-[10px] text-pos-muted">{store.customer.loyaltyPoints} pts</span>
                </div>
                <button className="text-[10px] text-pos-danger font-medium" onClick={() => store.clearCustomer()}>Retirer</button>
              </div>
            </div>
          )}

          {/* Sales Cockpit — shift performance (landscape only, too wide for portrait) */}
          {isLandscape && (
            <div className="px-2 pt-2">
              <SalesCockpit />
            </div>
          )}

          {/* AI Recommendations — shows only when confident signal exists */}
          <AiRecommendation />

          {/* Cart items — bigger touch targets in landscape */}
          <div className={`flex-1 overflow-y-auto cart-scroll space-y-1 ${isLandscape ? 'p-2' : 'p-2'}`}>
            {store.cartItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-pos-muted gap-2">
                <ShoppingBag size={32} strokeWidth={1} className="opacity-15" />
                <p className="text-xs font-medium opacity-50">Panier vide</p>
                <p className="text-[10px] opacity-30">Tap sur un produit pour l'ajouter</p>
              </div>
            ) : (
              store.cartItems.map((item) => (
                <div key={item.productId} className={`cart-item-landscape flex items-center gap-2 rounded-xl bg-pos-subtle/40 border border-pos-border/10 ${isLandscape ? 'px-2.5 py-2.5' : 'px-2 py-2'}`}>
                  {/* Avatar */}
                  <div className={`${isLandscape ? 'w-9 h-9' : 'w-8 h-8'} rounded-lg bg-gradient-to-br ${avatarColor(item.name)} flex items-center justify-center text-[10px] font-bold flex-shrink-0`}>
                    {initials(item.name)}
                  </div>
                  {/* Name + discount */}
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold truncate ${isLandscape ? 'text-[13px]' : 'text-sm'}`}>{item.name}</p>
                    {item.discountMinorUnits > 0 && (
                      <p className="text-[10px] text-pos-success font-medium">-{formatPrice(item.discountMinorUnits)}</p>
                    )}
                  </div>
                  {/* Quantity controls — bigger in landscape */}
                  <div className={`flex items-center bg-white rounded-full ${isLandscape ? 'gap-0.5 p-0.5' : 'gap-0.5 p-0.5'}`}>
                    <button
                      className={`qty-btn rounded-full flex items-center justify-center hover:bg-pos-subtle transition-colors product-card-touch ${isLandscape ? 'w-9 h-9' : 'w-8 h-8'}`}
                      onClick={() => store.updateQuantity(item.productId, item.quantity - 1)}
                    >
                      <Minus size={isLandscape ? 15 : 14} />
                    </button>
                    <span className={`qty-value text-center font-bold ${isLandscape ? 'w-8 text-[15px]' : 'w-7 text-sm'}`}>{item.quantity}</span>
                    <button
                      className={`qty-btn rounded-full flex items-center justify-center hover:bg-pos-subtle transition-colors product-card-touch ${isLandscape ? 'w-9 h-9' : 'w-8 h-8'}`}
                      onClick={() => store.updateQuantity(item.productId, item.quantity + 1)}
                    >
                      <Plus size={isLandscape ? 15 : 14} />
                    </button>
                  </div>
                  {/* Price */}
                  <div className="text-right w-16">
                    <p className={`font-bold ${isLandscape ? 'text-[13px]' : 'text-sm'}`}>{formatPrice(item.unitPriceMinorUnits * item.quantity)}</p>
                  </div>
                  {/* Remove */}
                  <button
                    className={`rounded-full flex items-center justify-center text-pos-muted hover:text-pos-danger hover:bg-pos-danger/10 transition-colors product-card-touch ${isLandscape ? 'w-8 h-8' : 'w-7 h-7'}`}
                    onClick={() => store.removeFromCart(item.productId)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Summary + Pay — prominent in landscape */}
          <div className={`summary-landscape border-t border-pos-border/20 space-y-1.5 ${isLandscape ? 'p-3' : 'p-3 space-y-2'}`}>
            {/* Subtotal */}
            <div className="flex justify-between text-xs text-pos-muted">
              <span>Sous-total</span>
              <span className="font-semibold">{formatPrice(store.subtotal())}</span>
            </div>
            {store.totalDiscount() > 0 && (
              <div className="flex justify-between text-xs text-pos-success">
                <span>Remise</span>
                <span className="font-semibold">-{formatPrice(store.totalDiscount())}</span>
              </div>
            )}

            {/* Total — BIG */}
            <div className="flex justify-between items-end pt-1 border-t border-pos-border/20">
              <span className="text-pos-muted text-xs font-medium">TOTAL</span>
              <span className={`total-amount font-black tracking-tight ${isLandscape ? 'text-[2rem]' : 'text-3xl'}`}>{formatPrice(store.total())}</span>
            </div>

            {/* Suspend + Pay buttons */}
            <div className={`flex gap-2 ${isLandscape ? 'pt-1' : 'pt-1'}`}>
              {/* Suspend button — icon only in landscape */}
              {store.cartItems.length > 0 && (
                <button
                  onClick={() => store.suspendTicket()}
                  className={`flex items-center justify-center gap-1.5 rounded-xl bg-amber-50 text-amber-600 font-semibold border border-amber-200 hover:bg-amber-100 transition-colors product-card-touch ${
                    isLandscape ? 'w-12 py-3' : 'w-12 py-2.5'
                  }`}
                  title="Mettre en attente"
                >
                  <Pause size={16} />
                </button>
              )}

              {/* Pay button — HUGE & prominent */}
              <button
                className={`pay-btn flex-1 flex items-center justify-center gap-2 rounded-2xl bg-pos-accent text-white font-black shadow-lg shadow-pos-accent/30 disabled:opacity-40 transition-all product-card-touch active:scale-[0.98] ${
                  isLandscape ? 'py-4 text-lg' : 'py-4 text-lg'
                }`}
                disabled={store.cartItems.length === 0 || payment.processing}
                onClick={() => store.setPaymentModalOpen(true)}
              >
                <CreditCard size={20} /> PAYER {store.cartItems.length > 0 && formatPrice(store.total())}
              </button>
            </div>

            {/* Clear button — smaller */}
            <button
              className={`w-full rounded-xl text-xs font-medium text-pos-muted hover:bg-pos-subtle transition-colors ${!rights.canVoid ? 'opacity-30 cursor-not-allowed' : ''} ${isLandscape ? 'py-1.5' : 'py-2'}`}
              onClick={() => rights.canVoid && store.clearCart()}
              disabled={!rights.canVoid || store.cartItems.length === 0}
            >
              Annuler tout
            </button>
          </div>
        </div>
      </div>

      {/* ═══ WEIGHT MODAL ═══ */}
      {cart.weightModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl shadow-elevated w-[400px] p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${avatarColor(cart.weightModal.name)} flex items-center justify-center font-bold`}>
                {initials(cart.weightModal.name)}
              </div>
              <div>
                <h3 className="font-bold text-lg">{cart.weightModal.name}</h3>
                <p className="text-sm text-amber-600 font-semibold flex items-center gap-1">
                  <Weight size={14} />{formatPrice(cart.weightModal.priceMinorUnits)}/kg
                </p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-pos-muted mb-2 uppercase tracking-wider">Poids (kg)</label>
              <input
                type="text"
                inputMode="decimal"
                className="w-full px-4 py-4 text-2xl font-bold text-center rounded-2xl border-2 border-amber-200 bg-amber-50/30 focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="0,000"
                value={cart.weightValue}
                onChange={(e) => cart.setWeightValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') cart.handleWeightConfirm();
                  if (e.key === 'Escape') { cart.setWeightModal(null); cart.setWeightValue(''); }
                }}
                autoFocus
              />
              <div className="flex gap-2 mt-3">
                {['0,100', '0,250', '0,500', '1,000'].map((w) => (
                  <button key={w} onClick={() => cart.setWeightValue(w)} className="flex-1 py-2.5 rounded-xl border border-amber-200 text-sm font-semibold text-amber-700 hover:bg-amber-50 transition-colors product-card-touch">
                    {w} kg
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { cart.setWeightModal(null); cart.setWeightValue(''); }} className="flex-1 py-3 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">Annuler</button>
              <button onClick={cart.handleWeightConfirm} disabled={!cart.weightValue} className="flex-1 py-3 rounded-xl text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-500/25 disabled:opacity-40 flex items-center justify-center gap-2 product-card-touch">
                <Plus size={16} /> Ajouter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PAYMENT MODAL ═══ */}
      {store.paymentModalOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl shadow-elevated w-[440px] p-6 space-y-4">
            <div className="text-center">
              <p className="text-sm text-pos-muted font-medium">Total</p>
              <p className="text-4xl font-black tracking-tight">{formatPrice(store.total())}</p>
              <p className="text-xs text-pos-muted mt-1">
                {store.cartItems.reduce((s, i) => s + i.quantity, 0)} article(s)
              </p>
            </div>

            {/* Partial payments */}
            {payment.partialPayments.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-pos-muted uppercase">Paiements enregistres</p>
                {payment.partialPayments.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-pos-subtle border border-pos-border/20">
                    {p.method === 'card' ? <CreditCard size={14} className="text-pos-accent" /> : <Banknote size={14} className="text-pos-success" />}
                    <span className="flex-1 text-sm font-medium">{methodLabel(p.method)}</span>
                    <span className="font-bold text-sm">{formatPrice(p.amountMinorUnits)}</span>
                    <button onClick={() => payment.removePartialPayment(p.id)} className="w-6 h-6 flex items-center justify-center rounded-full text-pos-muted hover:text-pos-danger hover:bg-pos-danger/10">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Remaining */}
            <div className={`rounded-xl p-3 text-center ${payment.remaining > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'}`}>
              <p className={`text-xs font-semibold uppercase ${payment.remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {payment.remaining > 0 ? 'Reste a percevoir' : 'Ticket solde'}
              </p>
              <p className={`text-2xl font-black mt-1 ${payment.remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {formatPrice(Math.max(payment.remaining, 0))}
              </p>
            </div>

            {payment.remaining > 0 && (
              <>
                {/* Amount input */}
                <div>
                  <label className="block text-xs font-semibold text-pos-muted mb-1 uppercase">Montant (vide = tout)</label>
                  <input
                    ref={payment.splitInputRef}
                    type="text"
                    inputMode="decimal"
                    className="w-full px-4 py-3 text-lg font-bold rounded-xl border border-pos-border/40 focus:outline-none focus:ring-2 focus:ring-pos-accent/30 text-center"
                    placeholder={formatPrice(payment.remaining)}
                    value={payment.splitAmountInput}
                    onChange={(e) => payment.setSplitAmountInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') payment.addPartialPayment('card');
                      if (e.key === 'Escape') store.setPaymentModalOpen(false);
                    }}
                  />
                </div>

                {/* Payment buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={`flex items-center justify-center gap-2 px-4 py-4 rounded-2xl border-2 transition-all font-semibold text-base product-card-touch ${
                      offlineMode.canPayByCard ? 'border-pos-border/40 hover:border-pos-accent hover:bg-pos-accent/5' : 'opacity-40 cursor-not-allowed'
                    }`}
                    onClick={() => offlineMode.canPayByCard && payment.addPartialPayment('card')}
                    disabled={!offlineMode.canPayByCard}
                  >
                    <CreditCard size={20} className="text-pos-accent" /> Carte
                  </button>
                  <button
                    className="flex items-center justify-center gap-2 px-4 py-4 rounded-2xl border-2 border-pos-border/40 hover:border-pos-success hover:bg-pos-success/5 transition-all font-semibold text-base product-card-touch"
                    onClick={() => payment.addPartialPayment('cash')}
                  >
                    <Banknote size={20} className="text-pos-success" /> Especes
                  </button>
                </div>
                {/* Additional tenders — no PSP, work offline; no cash change on these */}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    className="flex items-center justify-center gap-2 px-4 py-4 rounded-2xl border-2 border-pos-border/40 hover:border-amber-400 hover:bg-amber-50 transition-all font-semibold text-base product-card-touch"
                    onClick={() => payment.addPartialPayment('voucher')}
                    title="Titre-resto (aucune monnaie rendue)"
                  >
                    <Ticket size={20} className="text-amber-500" /> Titre-resto
                  </button>
                  <button
                    className="flex items-center justify-center gap-2 px-4 py-4 rounded-2xl border-2 border-pos-border/40 hover:border-violet-400 hover:bg-violet-50 transition-all font-semibold text-base product-card-touch"
                    onClick={() => payment.addPartialPayment('gift_card')}
                    title="Carte cadeau (aucune monnaie rendue)"
                  >
                    <Gift size={20} className="text-violet-500" /> Carte cadeau
                  </button>
                </div>
                <button
                  className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-4 rounded-2xl border-2 border-pos-border/40 hover:border-emerald-400 hover:bg-emerald-50 transition-all font-semibold text-base product-card-touch"
                  onClick={() => setAvoirOpen(true)}
                  title="Payer avec un avoir"
                >
                  <Ticket size={20} className="text-emerald-500" /> Payer par avoir
                </button>
              </>
            )}

            {/* Quick pay */}
            {payment.partialPayments.length === 0 && (
              <div className="border-t border-pos-border/20 pt-3 space-y-2">
                <p className="text-[10px] font-semibold text-pos-muted uppercase">Paiement rapide (total)</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={`flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl font-semibold text-sm transition-all product-card-touch ${
                      offlineMode.canPayByCard ? 'bg-pos-accent/5 border border-pos-accent/20 text-pos-accent hover:bg-pos-accent/10' : 'opacity-40 cursor-not-allowed'
                    }`}
                    onClick={() => offlineMode.canPayByCard && payment.handleQuickPayment('card')}
                    disabled={!offlineMode.canPayByCard}
                  >
                    <CreditCard size={16} /> Tout en CB
                  </button>
                  <button
                    className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-pos-success/5 border border-pos-success/20 text-pos-success font-semibold text-sm hover:bg-pos-success/10 transition-all product-card-touch"
                    onClick={() => payment.handleQuickPayment('cash')}
                  >
                    <Banknote size={16} /> Tout en especes
                  </button>
                </div>
              </div>
            )}

            <button
              className="w-full py-2.5 rounded-xl text-sm font-medium text-pos-muted hover:bg-pos-subtle transition-colors"
              onClick={() => store.setPaymentModalOpen(false)}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ═══ TPE OVERLAY ═══ */}
      {payment.tpeWaiting && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[100]">
          <div className="bg-white rounded-3xl shadow-elevated p-8 w-[400px] text-center">
            {!payment.tpeResult && (
              <>
                {payment.tpeWaiting.mode === 'demo' && (
                  <div className="mb-4 px-3 py-2 rounded-xl bg-amber-100 text-amber-800 text-xs font-black tracking-wide">
                    MODE DÉMO — aucun paiement réel. La vente restera « à régulariser ».
                  </div>
                )}
                <div className="relative mx-auto w-20 h-20 mb-5">
                  <div className="absolute inset-0 rounded-full bg-pos-accent/10 animate-ping" />
                  <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-pos-accent to-indigo-400 flex items-center justify-center">
                    <CreditCard size={36} className="text-white animate-pulse" />
                  </div>
                </div>
                <h3 className="text-xl font-black mb-1">{payment.tpeWaiting.mode === 'real' ? 'Presentez la carte sur le lecteur...' : 'En attente du TPE...'}</h3>
                <p className="text-2xl font-black text-pos-accent mb-4">{formatPrice(payment.tpeWaiting.amountMinorUnits)}</p>
                <div className="flex items-center justify-center gap-3 mb-4">
                  <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-pos-accent rounded-full transition-all duration-1000" style={{ width: `${(payment.tpeCountdown / payment.tpeWaiting.countdownTotal) * 100}%` }} />
                  </div>
                  <span className="text-sm font-mono text-pos-muted">{payment.tpeCountdown}s</span>
                </div>
                {payment.tpeWaiting.mode === 'demo' && (
                  <button
                    className="w-full py-3 mb-2 rounded-xl text-sm font-black bg-amber-500 text-white"
                    onClick={payment.simulateDemoTpeSuccess}
                  >
                    Simuler l'acceptation (DÉMO)
                  </button>
                )}
                <button className="w-full py-3 rounded-xl text-sm font-medium text-pos-muted hover:bg-pos-subtle" onClick={payment.cancelTpeWaiting}>Annuler</button>
              </>
            )}
            {payment.tpeResult === 'success' && (
              <>
                <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center mb-5">
                  <CheckCircle2 size={40} className="text-white" />
                </div>
                <h3 className="text-xl font-black text-emerald-600 mb-1">{payment.tpeWaiting.mode === 'demo' ? 'Paiement simule (DÉMO) — a regulariser' : 'Paiement accepte'}</h3>
                <p className="text-2xl font-black text-emerald-600">{formatPrice(payment.tpeWaiting.amountMinorUnits)}</p>
              </>
            )}
            {(payment.tpeResult === 'refused' || payment.tpeResult === 'timeout') && (
              <>
                <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-red-400 to-rose-500 flex items-center justify-center mb-5">
                  <XCircle size={40} className="text-white" />
                </div>
                <h3 className="text-xl font-black text-red-600 mb-1">{payment.tpeResult === 'refused' ? 'Paiement refuse' : 'Delai depasse'}</h3>
                {payment.tpeErrorMessage && (
                  <p className="text-sm text-pos-muted mb-2">{payment.tpeErrorMessage}</p>
                )}
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-pos-accent/10 text-pos-accent font-semibold text-sm product-card-touch"
                    onClick={() => {
                      const saved = payment.tpeWaitingRef.current || payment.tpeWaiting;
                      if (!saved) return;
                      payment.startTpeWaiting(saved.amountMinorUnits, saved.context);
                    }}
                  >
                    <CreditCard size={14} /> Reessayer
                  </button>
                  <button
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-pos-success/10 text-pos-success font-semibold text-sm product-card-touch"
                    onClick={() => {
                      const saved = payment.tpeWaitingRef.current || payment.tpeWaiting;
                      if (!saved) return;
                      payment.cancelTpeWaiting();
                      if (saved.context === 'quick') {
                        payment.handleQuickPayment('cash');
                      } else {
                        payment.commitPartialPayment('cash', saved.amountMinorUnits);
                      }
                    }}
                  >
                    <Banknote size={14} /> Especes
                  </button>
                </div>
                <button className="w-full py-2 mt-2 text-sm text-pos-muted hover:bg-pos-subtle rounded-xl" onClick={payment.cancelTpeWaiting}>Annuler</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══ CONFIRMATION OVERLAY ═══ */}
      {payment.confirmation && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-emerald-900/95 via-emerald-800/95 to-teal-900/95 backdrop-blur-xl">
          <div className="text-center space-y-6 max-w-md w-full px-6">
            <div className="mx-auto w-20 h-20 rounded-full bg-white/10 border-4 border-emerald-400 flex items-center justify-center">
              <CheckCircle2 size={40} className="text-emerald-400" />
            </div>
            <h1 className="text-2xl font-black text-white">PAIEMENT ACCEPTE</h1>
            <div className="bg-white/10 rounded-2xl p-5 backdrop-blur-sm border border-white/10">
              <p className="text-5xl font-black text-white">{formatPrice(payment.confirmation.total)}</p>
              <div className="flex items-center justify-center gap-3 mt-2 text-sm text-emerald-300/80">
                <span>{payment.confirmation.itemCount} article(s)</span>
                <span>{payment.confirmation.ticketNumber}</span>
              </div>
              {payment.confirmation.changeAmount > 0 && (
                <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-center gap-2 text-lg">
                  <Coins size={18} className="text-amber-400" />
                  <span className="font-black text-amber-400">Monnaie : {formatPrice(payment.confirmation.changeAmount)}</span>
                </div>
              )}
              {/* Honest print status — the platform must SAY when it cannot print */}
              {payment.lastPrintStatus === 'printed' && (
                <p className="mt-3 text-xs font-semibold text-emerald-300/80">Ticket imprimé</p>
              )}
              {payment.lastPrintStatus === 'print_failed' && (
                <p className="mt-3 text-xs font-black text-red-300">Ticket NON imprimé — échec imprimante. Réimpression possible depuis l'historique.</p>
              )}
              {payment.lastPrintStatus === 'no_printer' && (
                <p className="mt-3 text-xs font-black text-amber-300">Aucune imprimante connectée — ticket NON imprimé (QR / email disponibles).</p>
              )}
            </div>

            {/* Ticket choices — QR code primary, email secondary */}
            {!digitalReceipt ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => {
                    // Get the sale ID from the last sale (stored during finalizePayment)
                    const lastSaleId = (store as any).lastSaleId || '';
                    const receiptUrl = lastSaleId
                      ? `https://api.addxintelligence.com/api/receipts/${lastSaleId}/html`
                      : '';
                    setDigitalReceipt({
                      ticketNumber: payment.confirmation!.ticketNumber,
                      total: payment.confirmation!.total,
                      items: payment.confirmation!.itemCount,
                      date: new Date().toLocaleString('fr-FR'),
                      cashier: payment.confirmation!.cashierName,
                      receiptUrl,
                    });
                  }} className="flex flex-col items-center gap-2 p-5 rounded-2xl border-2 border-emerald-400/40 bg-emerald-500/10 hover:border-emerald-400/60 transition-all product-card-touch">
                    <QrCode size={28} className="text-emerald-300" />
                    <span className="text-sm font-bold text-emerald-300">Scanner le QR</span>
                    <span className="text-[10px] text-white/40">Le client scanne</span>
                  </button>
                  <button onClick={() => payment.handleTicketChoice('none')} className="flex flex-col items-center gap-2 p-5 rounded-2xl border-2 border-white/20 bg-white/5 hover:border-white/40 transition-all product-card-touch">
                    <ArrowRight size={28} className="text-white/60" />
                    <span className="text-sm font-semibold text-white">Terminer</span>
                    <span className="text-[10px] text-white/40">Sans reçu</span>
                  </button>
                </div>
              </div>
            ) : (
              /* QR Code receipt — customer scans with phone */
              <div className="bg-white rounded-2xl p-5 text-gray-900 space-y-4">
                <div className="text-center">
                  <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-3">Reçu Digital</p>
                  {digitalReceipt.receiptUrl ? (
                    <div className="flex justify-center">
                      <QRCodeSVG
                        value={digitalReceipt.receiptUrl}
                        size={180}
                        bgColor="#ffffff"
                        fgColor="#1a1a1a"
                        level="M"
                        includeMargin
                      />
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-2xl font-black">{formatPrice(digitalReceipt.total)}</p>
                      <p className="text-xs text-gray-500 mt-1">{digitalReceipt.ticketNumber}</p>
                    </div>
                  )}
                  <p className="text-sm font-bold mt-2">{formatPrice(digitalReceipt.total)}</p>
                  <p className="text-xs text-gray-400">{digitalReceipt.ticketNumber} • {digitalReceipt.items} article(s)</p>
                  <p className="text-[10px] text-gray-400 mt-2">Le client scanne avec son téléphone</p>
                </div>
                <button
                  onClick={() => { setDigitalReceipt(null); payment.handleTicketChoice('digital'); }}
                  className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm active:scale-95 transition-transform"
                >
                  → Nouvelle vente
                </button>
              </div>
            )}

            {/* Countdown */}
            <div className="space-y-1">
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full transition-all duration-1000" style={{ width: `${(payment.ticketCountdown / (payment.TICKET_TIMEOUT_MS / 1000)) * 100}%` }} />
              </div>
              <p className="text-xs text-white/40">Nouvelle vente dans {payment.ticketCountdown}s</p>
            </div>

            <button
              onClick={() => payment.completeTransaction()}
              className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-white/15 hover:bg-white/25 border-2 border-white/30 text-white font-black text-lg transition-all product-card-touch"
            >
              <ArrowRight size={20} className="text-emerald-300" />
              Nouvelle Vente
            </button>
          </div>
        </div>
      )}

      {/* ═══ SUSPENDED TICKETS DRAWER ═══ */}
      <SuspendedTicketsDrawer open={suspendedOpen} onClose={() => setSuspendedOpen(false)} />

      {/* ═══ TICKET HISTORY MODAL ═══ */}
      <TicketHistoryModal
        open={ticketHistory.historyOpen}
        onClose={ticketHistory.closeHistory}
        historySearch={ticketHistory.historySearch}
        onSearchChange={ticketHistory.setHistorySearch}
        historyFilterTime={ticketHistory.historyFilterTime}
        onFilterTimeChange={ticketHistory.setHistoryFilterTime}
        filteredHistory={ticketHistory.filteredHistory}
        searchRef={ticketHistory.historySearchRef}
        confirmPrintTicket={ticketHistory.confirmPrintTicket}
        onConfirmPrintTicket={ticketHistory.setConfirmPrintTicket}
        duplicatePreview={ticketHistory.duplicatePreview}
        onDuplicatePreview={ticketHistory.setDuplicatePreview}
        onReprint={ticketHistory.handleReprint}
        compact
      />

      {avoirOpen && (
        <AvoirTenderModal
          amountDueMinor={payment.remaining}
          onApply={(code, amt) => { payment.commitPartialPayment('store_credit', amt, code); setAvoirOpen(false); }}
          onClose={() => setAvoirOpen(false)}
        />
      )}
    </div>
  );
}
