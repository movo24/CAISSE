import React from 'react';
import {
  Search, CreditCard, Banknote, X, Clock, Trash2, Coins,
  History, RotateCcw, Printer, Receipt, AlertTriangle,
  User, Lock as LockIcon,
} from 'lucide-react';
import { usePOSStore, TicketHistoryEntry } from '../../stores/posStore';
import { useRights } from '../../hooks/useRights';
import { peripheralBridge } from '../../services/peripheralBridge';
import { buildTicketData } from '../../services/salePeripherals';
import { buildTicketUrl, makeTicketQrDataUrl } from '../../services/ticketQr';

/* ── Helpers ── */

function formatPrice(minorUnits: number) {
  return (minorUnits / 100).toFixed(2).replace('.', ',') + ' \u20ac';
}

/* ── Props ── */

interface TicketHistoryModalProps {
  open: boolean;
  onClose: () => void;

  // Search & filters
  historySearch: string;
  onSearchChange: (value: string) => void;
  historyFilterTime: 'all' | 'last1h' | 'last3h' | 'today';
  onFilterTimeChange: (filter: 'all' | 'last1h' | 'last3h' | 'today') => void;
  filteredHistory: TicketHistoryEntry[];
  searchRef?: React.RefObject<HTMLInputElement>;

  // Reprint
  confirmPrintTicket: TicketHistoryEntry | null;
  onConfirmPrintTicket: (ticket: TicketHistoryEntry | null) => void;
  duplicatePreview: TicketHistoryEntry | null;
  onDuplicatePreview: (ticket: TicketHistoryEntry | null) => void;
  onReprint: (ticket: TicketHistoryEntry) => void;

  // Compact mode for iPad (optional)
  compact?: boolean;
}

/**
 * Shared ticket history modal.
 * Used in both Desktop and iPad POS layouts.
 *
 * Contains 3 sub-views:
 *  1. History list with search + time filters
 *  2. Print confirmation popup
 *  3. Duplicate ticket preview (thermal receipt style)
 */
export function TicketHistoryModal({
  open,
  onClose,
  historySearch,
  onSearchChange,
  historyFilterTime,
  onFilterTimeChange,
  filteredHistory,
  searchRef,
  confirmPrintTicket,
  onConfirmPrintTicket,
  duplicatePreview,
  onDuplicatePreview,
  onReprint,
  compact = false,
}: TicketHistoryModalProps) {
  const store = usePOSStore();
  const rights = useRights();

  if (!open && !duplicatePreview && !confirmPrintTicket) return null;

  const modalWidth = compact ? 'w-full max-w-[600px]' : 'w-[640px]';
  const confirmWidth = compact ? 'w-full max-w-[400px]' : 'w-[420px]';
  const previewWidth = compact ? 'w-full max-w-[380px]' : 'w-[400px]';

  return (
    <>
      {/* ═══ HISTORY LIST ═══ */}
      {open && !duplicatePreview && !confirmPrintTicket && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className={`bg-white rounded-3xl shadow-elevated ${modalWidth} max-h-[85vh] flex flex-col animate-scale-in ${compact ? 'mx-4' : ''}`}>
            {/* Header */}
            <div className={`${compact ? 'p-4 pb-3' : 'p-6 pb-4'} border-b border-pos-border/20`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`${compact ? 'w-9 h-9' : 'w-10 h-10'} rounded-xl bg-indigo-50 flex items-center justify-center`}>
                    <Receipt size={compact ? 18 : 20} className="text-indigo-600" />
                  </div>
                  <div>
                    <h2 className={`font-bold text-pos-text ${compact ? 'text-base' : 'text-lg'}`}>Historique des tickets</h2>
                    <p className="text-xs text-pos-muted">{store.ticketHistory.length} transaction{store.ticketHistory.length > 1 ? 's' : ''}</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full hover:bg-pos-subtle flex items-center justify-center transition-colors product-card-touch"
                >
                  <X size={18} className="text-pos-muted" />
                </button>
              </div>

              {/* Search + filters */}
              <div className="space-y-3">
                <div className="relative">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-pos-muted/40" />
                  <input
                    ref={searchRef as any}
                    type="text"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-pos-border/40 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-sm transition-all"
                    placeholder="N\u00b0 ticket, montant, caissier, produit..."
                    value={historySearch}
                    onChange={(e) => onSearchChange(e.target.value)}
                  />
                </div>
                <div className="flex gap-1.5">
                  {([['all', 'Tout'], ['last1h', '1h'], ['last3h', '3h'], ['today', "Aujourd'hui"]] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => onFilterTimeChange(key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors product-card-touch ${
                        historyFilterTime === key
                          ? 'bg-indigo-600 text-white'
                          : 'bg-pos-subtle text-pos-muted hover:bg-indigo-50 hover:text-indigo-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Ticket List */}
            <div className="flex-1 overflow-auto p-4 cart-scroll">
              {filteredHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-pos-muted gap-3">
                  <Receipt size={48} strokeWidth={1} className="opacity-20" />
                  <p className="text-sm font-medium opacity-60">
                    {historySearch ? 'Aucun ticket ne correspond a votre recherche' : "Aucun ticket dans l'historique"}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredHistory.map((ticket) => (
                    <button
                      key={ticket.ticketNumber}
                      onClick={() => onConfirmPrintTicket(ticket)}
                      className={`w-full flex items-center gap-3 rounded-2xl border border-pos-border/20 bg-white hover:bg-pos-subtle hover:border-indigo-200 transition-all text-left group product-card-touch ${
                        compact ? 'p-3' : 'p-4 gap-4'
                      }`}
                    >
                      <div className={`${compact ? 'w-10 h-10' : 'w-11 h-11'} rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 flex items-center justify-center flex-shrink-0 border border-indigo-100 group-hover:border-indigo-200 transition-colors`}>
                        <Receipt size={compact ? 16 : 18} className="text-indigo-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-bold text-pos-text ${compact ? 'text-xs' : 'text-sm'}`}>{ticket.ticketNumber}</p>
                          {ticket.reprintCount > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full ring-1 ring-amber-200">
                              <RotateCcw size={8} /> {ticket.reprintCount}x
                            </span>
                          )}
                          {ticket.payments.length > 1 && (
                            <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded-full ring-1 ring-violet-200">
                              MIXTE
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-pos-muted flex items-center gap-1">
                            <Clock size={10} />
                            {new Date(ticket.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="text-[11px] text-pos-muted">{ticket.items.length} art.</span>
                          <span className="text-[11px] text-pos-muted">{ticket.cashierName}</span>
                          {ticket.customerName && (
                            <span className="text-[11px] text-indigo-500 flex items-center gap-0.5">
                              <User size={9} />{ticket.customerName}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`font-bold text-pos-text ${compact ? 'text-sm' : 'text-base'}`}>{formatPrice(ticket.totalMinorUnits)}</p>
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          {ticket.payments.map((p, idx) => (
                            <span key={idx} className={`w-5 h-5 rounded-md flex items-center justify-center ${p.method === 'card' ? 'bg-indigo-50' : 'bg-emerald-50'}`}>
                              {p.method === 'card' ? <CreditCard size={10} className="text-indigo-400" /> : <Banknote size={10} className="text-emerald-400" />}
                            </span>
                          ))}
                        </div>
                      </div>
                      <Printer size={14} className="flex-shrink-0 text-pos-border group-hover:text-indigo-400 transition-colors" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ PRINT CONFIRMATION POPUP ═══ */}
      {confirmPrintTicket && !duplicatePreview && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[55] animate-fade-in">
          <div className={`bg-white rounded-3xl shadow-elevated ${confirmWidth} p-7 space-y-6 animate-scale-in ${compact ? 'mx-4' : ''}`}>
            {/* Icon */}
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                <Printer size={32} className="text-indigo-600" />
              </div>
            </div>

            {/* Message */}
            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-pos-text">Voulez-vous imprimer la facture ?</h3>
              <p className="text-sm text-pos-muted">
                Le ticket <span className="font-bold text-pos-text">{confirmPrintTicket.ticketNumber}</span> sera
                reimprime avec la mention <span className="font-bold text-red-600">DUPLICATA</span>.
              </p>
            </div>

            {/* Ticket summary */}
            <div className="rounded-2xl bg-pos-subtle border border-pos-border/20 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-pos-muted font-semibold uppercase tracking-wider">Resume</span>
                <span className="text-xs text-pos-muted flex items-center gap-1">
                  <Clock size={10} />
                  {new Date(confirmPrintTicket.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-pos-muted">{confirmPrintTicket.items.length} article{confirmPrintTicket.items.length > 1 ? 's' : ''}</span>
                <span className="text-xl font-black text-pos-text">{formatPrice(confirmPrintTicket.totalMinorUnits)}</span>
              </div>
              <div className="flex items-center gap-2">
                {confirmPrintTicket.payments.map((p, idx) => (
                  <span key={idx} className="flex items-center gap-1 text-xs text-pos-muted bg-white px-2 py-1 rounded-lg border border-pos-border/20">
                    {p.method === 'card' ? <CreditCard size={10} className="text-indigo-400" /> : <Banknote size={10} className="text-emerald-400" />}
                    {formatPrice(p.amountMinorUnits)}
                  </span>
                ))}
              </div>
              {confirmPrintTicket.reprintCount > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-600 pt-1">
                  <AlertTriangle size={11} />
                  Deja reimprime {confirmPrintTicket.reprintCount} fois
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => onConfirmPrintTicket(null)}
                className="flex-1 py-3.5 rounded-xl text-sm font-semibold text-pos-muted hover:bg-pos-subtle border border-pos-border/30 transition-colors product-card-touch"
              >
                Annuler
              </button>
              <button
                onClick={() => rights.canReprintTicket && onReprint(confirmPrintTicket)}
                disabled={!rights.canReprintTicket}
                className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm transition-colors shadow-lg product-card-touch ${
                  rights.canReprintTicket
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-600/25'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                }`}
                title={!rights.canReprintTicket ? 'Droit insuffisant — reimpression non autorisee' : undefined}
              >
                {rights.canReprintTicket ? <Printer size={16} /> : <LockIcon size={16} />}
                {rights.canReprintTicket ? 'Imprimer' : 'Non autorise'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DUPLICATE TICKET PREVIEW ═══ */}
      {duplicatePreview && (() => {
        const si = store.storeInfo;
        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in">
            <div className={`bg-white rounded-3xl shadow-elevated ${previewWidth} max-h-[90vh] overflow-auto animate-scale-in ${compact ? 'mx-4' : ''}`}>
              {/* Thermal receipt style */}
              <div className="p-6 space-y-3 font-mono text-sm">
                {/* DUPLICATA banner */}
                <div className="text-center py-3 bg-red-50 border-2 border-dashed border-red-300 rounded-xl">
                  <p className="text-xl font-black text-red-600 tracking-[0.3em]">DUPLICATA</p>
                  <p className="text-[10px] text-red-400 mt-1 font-sans">
                    Reimpression du {new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>

                {/* Store identity */}
                <div className="text-center space-y-0.5">
                  <p className="font-black text-base tracking-wider font-sans">{si?.storeName || 'MAGASIN'}</p>
                  {(si as any)?.formeJuridique && (
                    <p className="text-[10px] text-pos-muted">
                      {(si as any).formeJuridique}{(si as any)?.capitalSocial ? ` au capital de ${(si as any).capitalSocial}` : ''}
                    </p>
                  )}
                  <p className="text-[11px] text-pos-muted">{si?.address || ''}{si?.postalCode ? ` - ${si.postalCode}` : ''} {si?.city || ''}</p>
                  {si?.phone && <p className="text-[11px] text-pos-muted">Tel: {si.phone}</p>}
                </div>

                {/* Legal identifiers */}
                <div className="text-center space-y-0.5 text-[10px] text-pos-muted">
                  {si?.siret && <p>SIRET: {si.siret}</p>}
                  {si?.rcs && <p>{si.rcs}</p>}
                  {si?.tvaIntracom && <p>TVA Intracom: {si.tvaIntracom}</p>}
                  {si?.naf && <p>Code NAF: {si.naf}</p>}
                </div>

                {(si as any)?.headerMessage && (
                  <p className="text-center text-[10px] text-pos-muted font-sans italic">{(si as any).headerMessage}</p>
                )}

                <div className="border-t border-dashed border-gray-300" />

                {/* Ticket info */}
                <div className="flex justify-between text-xs text-pos-muted">
                  <span>Ticket: {duplicatePreview.ticketNumber}</span>
                  <span>{new Date(duplicatePreview.timestamp).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="flex justify-between text-xs text-pos-muted">
                  <span>Caissier: {duplicatePreview.cashierName}</span>
                  {duplicatePreview.customerName && <span>Client: {duplicatePreview.customerName}</span>}
                </div>

                <div className="border-t border-dashed border-gray-300" />

                {/* Items */}
                <div className="space-y-2">
                  {duplicatePreview.items.map((item, idx) => (
                    <div key={idx}>
                      <div className="flex justify-between">
                        <span className="flex-1 truncate">{item.name}</span>
                      </div>
                      <div className="flex justify-between text-xs text-pos-muted pl-4">
                        <span>{item.quantity} x {formatPrice(item.unitPriceMinorUnits)}</span>
                        <span className="font-semibold text-pos-text">{formatPrice(item.unitPriceMinorUnits * item.quantity)}</span>
                      </div>
                      {item.discountMinorUnits > 0 && (
                        <div className="flex justify-between text-xs text-pos-success pl-4">
                          <span>Remise</span>
                          <span>-{formatPrice(item.discountMinorUnits)}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="border-t border-dashed border-gray-300" />

                {/* Totals */}
                {duplicatePreview.discountMinorUnits > 0 && (
                  <>
                    <div className="flex justify-between text-xs">
                      <span>Sous-total</span>
                      <span>{formatPrice(duplicatePreview.subtotalMinorUnits)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-pos-success">
                      <span>Remise totale</span>
                      <span>-{formatPrice(duplicatePreview.discountMinorUnits)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-lg font-black font-sans">
                  <span>TOTAL</span>
                  <span>{formatPrice(duplicatePreview.totalMinorUnits)}</span>
                </div>

                <div className="border-t border-dashed border-gray-300" />

                {/* Payments */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-pos-muted font-sans">Mode(s) de paiement</p>
                  {duplicatePreview.payments.map((p, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span className="flex items-center gap-1.5">
                        {p.method === 'card' ? <CreditCard size={12} /> : <Banknote size={12} />}
                        {p.method === 'card' ? 'CARTE BANCAIRE' : 'ESPECES'}
                      </span>
                      <span className="font-semibold">{formatPrice(p.amountMinorUnits)}</span>
                    </div>
                  ))}
                  {duplicatePreview.changeMinorUnits > 0 && (
                    <div className="flex justify-between text-amber-600">
                      <span className="flex items-center gap-1.5"><Coins size={12} /> MONNAIE RENDUE</span>
                      <span className="font-semibold">{formatPrice(duplicatePreview.changeMinorUnits)}</span>
                    </div>
                  )}
                </div>

                <div className="border-t border-dashed border-gray-300" />

                {/* Software / NF525 certification */}
                <div className="text-center space-y-0.5 text-[9px] text-pos-muted">
                  {(si as any)?.softwareName && <p>Logiciel: {(si as any).softwareName} v{(si as any)?.softwareVersion || '1.0'}</p>}
                  {(si as any)?.nifCaisse && <p>Certification NF525: {(si as any).nifCaisse}</p>}
                </div>

                {/* Duplicata footer */}
                <div className="text-center space-y-2">
                  <div className="py-2 bg-red-50 border border-dashed border-red-300 rounded-lg">
                    <p className="text-xs font-black text-red-600 tracking-widest">*** DUPLICATA ***</p>
                    <p className="text-[9px] text-red-400 mt-0.5 font-sans">Ce document n'a aucune valeur comptable</p>
                  </div>
                  <p className="text-[10px] text-pos-muted font-sans">{(si as any)?.footerMessage || 'Merci de votre visite !'}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="p-5 border-t border-pos-border/20 flex gap-2">
                <button
                  onClick={() => onDuplicatePreview(null)}
                  className="flex-1 py-3 rounded-xl text-sm font-medium text-pos-muted hover:bg-pos-subtle transition-colors product-card-touch"
                >
                  Fermer
                </button>
                <button
                  onClick={async () => {
                    // Réimpression RÉELLE d'un duplicata (traçabilité déjà loggée
                    // à l'ouverture). Marqué DUPLICATA, sans valeur comptable.
                    // Réimpression = MÊME jeton public → EXACTEMENT le même QR
                    // que le ticket d'origine (jamais de nouveau jeton ici).
                    const sameToken = (duplicatePreview as any).publicToken || null;
                    const qrEnabled = (si as any)?.receiptQrEnabled !== false;
                    const sameUrl = qrEnabled
                      ? buildTicketUrl((si as any)?.receiptPublicBaseUrl, sameToken)
                      : null;
                    const qrDataUrl = sameUrl ? await makeTicketQrDataUrl(sameUrl) : null;
                    const td = buildTicketData({
                      storeName: si?.storeName,
                      storeAddress: (si as any)?.address,
                      addressLine2: [(si as any)?.postalCode, (si as any)?.city].filter(Boolean).join(' ') || undefined,
                      operatingCompanyName: (si as any)?.operatingCompanyName || undefined,
                      siret: (si as any)?.siret,
                      tvaIntracom: (si as any)?.tvaIntracom,
                      rcs: (si as any)?.rcs || undefined,
                      capitalSocial: (si as any)?.capitalSocial || undefined,
                      phone: (si as any)?.phone || undefined,
                      website: (si as any)?.websiteUrl || undefined,
                      nifCaisse: (si as any)?.nifCaisse,
                      softwareVersion: (si as any)?.softwareVersion || undefined,
                      logoDataUrl: (si as any)?.receiptLogoUrl || null,
                      ticketNumber: duplicatePreview.ticketNumber,
                      date: new Date(duplicatePreview.timestamp),
                      cashierName: duplicatePreview.cashierName,
                      items: duplicatePreview.items.map((it: any) => ({
                        name: it.name,
                        quantity: it.quantity,
                        unitPriceMinorUnits: it.unitPriceMinorUnits,
                        discountMinorUnits: it.discountMinorUnits,
                        taxRate: it.taxRate,
                      })),
                      subtotalMinorUnits: duplicatePreview.subtotalMinorUnits,
                      discountMinorUnits: duplicatePreview.discountMinorUnits,
                      totalMinorUnits: duplicatePreview.totalMinorUnits,
                      payments: duplicatePreview.payments.map((p: any) => ({ method: p.method, amountMinorUnits: p.amountMinorUnits })),
                      changeMinorUnits: duplicatePreview.changeMinorUnits,
                      footer: "DUPLICATA — Ce document n'a aucune valeur comptable",
                      qrDataUrl,
                      qrContent: qrDataUrl ? sameUrl : null,
                      qrText: qrDataUrl
                        ? (si as any)?.receiptQrText || 'Scannez pour retrouver votre ticket et découvrir nos nouveautés'
                        : undefined,
                    });
                    try {
                      const ok = await peripheralBridge.printTicket(td, { allowBrowserFallback: false });
                      if (!ok) console.warn('[PRINT] Duplicata NON imprimé — échec imprimante');
                    } catch (e) {
                      console.warn('[PRINT] Duplicata échec:', e);
                    }
                    onDuplicatePreview(null);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-600/25 product-card-touch"
                >
                  <Printer size={16} /> Imprimer
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
