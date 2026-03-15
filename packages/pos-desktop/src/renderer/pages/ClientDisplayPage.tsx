import React, { useCallback, useState, useEffect } from 'react';
import { QrCode, ShoppingBag, Sparkles, Star, Tag } from 'lucide-react';
import { usePOSStore } from '../stores/posStore';
import { JackpotOverlay } from '../components/JackpotOverlay';

/**
 * Client Display - Second Screen
 *
 * Lifestyle / Concept Store design:
 * - Idle: Hero promo zone (fullscreen image/video) + QR Loyalty CTA
 * - Active: Split-screen → product hero image (30%) + cart list
 * - Jackpot overlay on top
 */

/** Product initials for avatar */
function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

/** Promo carousel slides */
const promoSlides = [
  {
    title: '3eme paire a -50%',
    subtitle: 'Offre exclusive en magasin',
    gradient: 'from-rose-600 via-pink-600 to-purple-700',
    icon: Tag,
  },
  {
    title: 'Programme Fidelite',
    subtitle: 'Cumulez des points a chaque achat',
    gradient: 'from-violet-600 via-indigo-600 to-blue-700',
    icon: Star,
  },
  {
    title: 'Nouvelle Collection',
    subtitle: 'Decouvrez les nouveautes de la saison',
    gradient: 'from-emerald-600 via-teal-600 to-cyan-700',
    icon: Sparkles,
  },
];

export function ClientDisplayPage() {
  const store = usePOSStore();
  const [currentSlide, setCurrentSlide] = useState(0);

  const formatPrice = (minorUnits: number) =>
    (minorUnits / 100).toFixed(2).replace('.', ',') + ' \u20ac';

  const hasItems = store.cartItems.length > 0;
  const jackpotResult = store.jackpotResult;
  const lastItem = hasItems ? store.cartItems[store.cartItems.length - 1] : null;

  const handleJackpotComplete = useCallback(() => {
    store.clearJackpotResult();
  }, []);

  // Auto-rotate promo slides
  useEffect(() => {
    if (hasItems) return;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % promoSlides.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [hasItems]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col overflow-hidden">
      {/* Jackpot Overlay — takes over entire screen */}
      {jackpotResult && (
        <JackpotOverlay
          result={jackpotResult}
          onComplete={handleJackpotComplete}
        />
      )}

      {hasItems ? (
        /* ── Active: Cart mode ── */
        <div className="flex-1 flex flex-col">
          {/* Top: Last scanned product hero */}
          {lastItem && (
            <div className="relative h-[35%] min-h-[200px] bg-gradient-to-br from-[#111] to-[#1a1a2e] flex items-center justify-center overflow-hidden">
              {/* Large product avatar */}
              <div className="flex flex-col items-center gap-4 animate-scale-in" key={lastItem.productId}>
                <div className="w-32 h-32 rounded-3xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center text-4xl font-black text-white/60 backdrop-blur">
                  {initials(lastItem.name)}
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{lastItem.name}</p>
                  <p className="text-white/40 font-mono text-sm mt-1">{lastItem.ean}</p>
                  <p className="text-3xl font-black mt-3 text-transparent bg-clip-text bg-gradient-to-r from-white to-white/80">
                    {formatPrice(lastItem.unitPriceMinorUnits)}
                  </p>
                </div>
              </div>
              {/* Decorative blur */}
              <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-[300px] h-[100px] bg-pos-accent/10 rounded-full blur-3xl" />
            </div>
          )}

          {/* Items list */}
          <div className="flex-1 overflow-auto px-8 py-5 space-y-2.5">
            {store.cartItems.map((item, idx) => (
              <div
                key={item.productId}
                className="flex items-center justify-between bg-white/[0.04] backdrop-blur rounded-2xl px-5 py-3.5 border border-white/[0.06]"
                style={{
                  animation: `slideUp 0.3s ease-out ${idx * 0.04}s both`,
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-xs font-bold text-white/50">
                    {initials(item.name)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{item.name}</p>
                    <p className="text-white/30 text-xs">
                      {item.quantity > 1 && `${item.quantity} x ${formatPrice(item.unitPriceMinorUnits)}`}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-base font-bold">
                    {formatPrice(item.unitPriceMinorUnits * item.quantity)}
                  </p>
                  {item.discountMinorUnits > 0 && (
                    <p className="text-emerald-400 text-xs font-medium">
                      -{formatPrice(item.discountMinorUnits)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Customer badge */}
          {store.customer && (
            <div className="mx-8 mb-4 bg-gradient-to-r from-violet-500/15 to-purple-500/15 rounded-2xl px-6 py-3 border border-violet-500/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center">
                    <Star size={14} className="text-violet-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-violet-300">
                      Bonjour {store.customer.firstName} !
                    </p>
                    <p className="text-violet-400/50 text-xs">
                      {store.customer.loyaltyPoints} points
                    </p>
                  </div>
                </div>
                {store.customer.isFirstPurchase && (
                  <span className="text-[10px] bg-emerald-500 text-white px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">
                    -5% Bienvenue
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Total bar */}
          <div className="bg-white/[0.06] backdrop-blur-xl p-8 border-t border-white/[0.08]">
            {store.totalDiscount() > 0 && (
              <div className="flex justify-between text-emerald-400 text-sm mb-3">
                <span>Remise totale</span>
                <span className="font-semibold">-{formatPrice(store.totalDiscount())}</span>
              </div>
            )}
            <div className="flex items-end justify-between">
              <div>
                <span className="text-white/40 text-sm font-medium block">Total</span>
                <span className="text-white/30 text-xs">
                  {store.cartItems.reduce((s, i) => s + i.quantity, 0)} article(s)
                </span>
              </div>
              <span className="text-6xl font-black tracking-tight leading-none">
                {formatPrice(store.total())}
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* ── Idle: Hero promo + QR Loyalty ── */
        <div className="flex-1 relative flex flex-col">
          {/* Fullscreen promo hero */}
          <div className="flex-1 relative overflow-hidden">
            {promoSlides.map((slide, idx) => {
              const SlideIcon = slide.icon;
              return (
                <div
                  key={idx}
                  className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-1000 ${
                    idx === currentSlide ? 'opacity-100 scale-100' : 'opacity-0 scale-105'
                  }`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${slide.gradient} opacity-90`} />
                  <div className="relative z-10 text-center px-12">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white/10 backdrop-blur mb-6">
                      <SlideIcon size={36} className="text-white" />
                    </div>
                    <h2 className="text-5xl font-black tracking-tight leading-tight">
                      {slide.title}
                    </h2>
                    <p className="text-xl text-white/70 mt-3 font-medium">
                      {slide.subtitle}
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Slide indicators */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2 z-10">
              {promoSlides.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    idx === currentSlide ? 'w-8 bg-white' : 'w-1.5 bg-white/30'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Bottom: QR Loyalty CTA */}
          <div className="bg-black/60 backdrop-blur-xl border-t border-white/10 px-8 py-6">
            <div className="flex items-center justify-between max-w-lg mx-auto">
              <div>
                <p className="text-lg font-bold">Programme Fidelite</p>
                <p className="text-white/50 text-sm mt-0.5">
                  Scannez pour vos avantages
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center">
                  <QrCode size={40} className="text-[#0a0a0a]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden preload elements for jackpot media */}
      <div className="hidden">
        <video preload="auto" src="" id="preload-roulette" />
        <video preload="auto" src="" id="preload-win" />
        <video preload="auto" src="" id="preload-thanks" />
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
