import React from 'react';
import { X, Pause, Play, Trash2, ShoppingBag, Clock } from 'lucide-react';
import { usePOSStore, SuspendedTicket } from '../../stores/posStore';

interface SuspendedTicketsDrawerProps {
  open: boolean;
  onClose: () => void;
}

function formatPrice(minorUnits: number) {
  return (minorUnits / 100).toFixed(2).replace('.', ',') + ' \u20ac';
}

export function SuspendedTicketsDrawer({ open, onClose }: SuspendedTicketsDrawerProps) {
  const store = usePOSStore();
  const tickets = store.suspendedTickets;

  if (!open) return null;

  const handleResume = (ticketId: string) => {
    // If current cart has items, suspend it first
    if (store.cartItems.length > 0) {
      store.suspendTicket('Swap auto');
    }
    store.resumeTicket(ticketId);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-80 bg-white shadow-elevated z-50 flex flex-col animate-slide-left">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-pos-border/20 bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-center gap-2">
            <Pause size={16} className="text-amber-600" />
            <span className="font-bold text-sm text-pos-text">Tickets en attente</span>
            <span className="text-xs font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
              {tickets.length}
            </span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/50 transition-colors">
            <X size={16} className="text-pos-muted" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 cart-scroll">
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-pos-muted gap-3">
              <ShoppingBag size={40} strokeWidth={1} className="opacity-20" />
              <p className="text-sm opacity-60">Aucun ticket en attente</p>
            </div>
          ) : (
            tickets.map((ticket) => {
              const total = ticket.items.reduce(
                (sum, i) => sum + i.unitPriceMinorUnits * i.quantity - i.discountMinorUnits,
                0,
              );
              const itemCount = ticket.items.reduce((s, i) => s + i.quantity, 0);
              return (
                <div key={ticket.id} className="bg-pos-subtle rounded-xl border border-pos-border/20 p-3 space-y-2">
                  {/* Info */}
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-pos-text">
                        {itemCount} article{itemCount > 1 ? 's' : ''} — {formatPrice(total)}
                      </p>
                      <p className="text-[11px] text-pos-muted flex items-center gap-1 mt-0.5">
                        <Clock size={10} />
                        {new Date(ticket.suspendedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        {' — '}{ticket.cashierName}
                      </p>
                      {ticket.note && (
                        <p className="text-[11px] text-amber-600 mt-1 italic">{ticket.note}</p>
                      )}
                      {ticket.customer && (
                        <p className="text-[11px] text-violet-600 mt-0.5">
                          Client: {ticket.customer.firstName} {ticket.customer.lastName}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Items preview */}
                  <div className="text-[10px] text-pos-muted space-y-0.5 max-h-16 overflow-hidden">
                    {ticket.items.slice(0, 3).map((item, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span className="truncate">{item.quantity}x {item.name}</span>
                        <span>{formatPrice(item.unitPriceMinorUnits * item.quantity)}</span>
                      </div>
                    ))}
                    {ticket.items.length > 3 && (
                      <p className="text-pos-muted/50">+{ticket.items.length - 3} autres...</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => store.deleteSuspendedTicket(ticket.id)}
                      className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold text-red-500 bg-red-50 hover:bg-red-100 transition-colors product-card-touch"
                    >
                      <Trash2 size={12} /> Supprimer
                    </button>
                    <button
                      onClick={() => handleResume(ticket.id)}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors product-card-touch"
                    >
                      <Play size={12} /> Reprendre
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
