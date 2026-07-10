import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Star, CheckCircle2, CreditCard, Loader2, MonitorSmartphone, Heart, Candy, CupSoda, Sparkles } from 'lucide-react';
import { useCustomerDisplay } from '../hooks/useCustomerDisplay';
import { formatPrice, type DisplaySnapshot } from '../services/customerDisplay/snapshot';
import { terminalLabel, type CustomerDisplaySettings } from '../services/customerDisplay/settings';
import type { PaymentInfo } from '../hooks/useCustomerDisplay';
import { WesleysWordmark } from '../components/WesleysWordmark';

/**
 * Customer Display (screen 2) — vertical 9:16, identité The Wesley's.
 *
 * Écran client dédié, non tactile. Rend un unique état dérivé par la machine
 * pure (OFF / IDLE / CART_ACTIVE / PAYMENT_* / ERROR_FALLBACK) plus les overlays
 * identify/diagnostic. STRICTEMENT en lecture seule : il miroite le panier et le
 * paiement pilotés par l'opérateur, il ne peut jamais les muter.
 *
 * Design : identité The Wesley's — blanc + magenta, lumineux, premium. Le
 * « stage » 9:16 est centré, letterboxé sur fenêtre non-portrait, et garde
 * toujours le ratio 1080×1920 quelle que soit la résolution.
 */

const MAX_VISIBLE_ITEMS = 8;

/** Palette de marque (centralisée pour cohérence). */
const WESLEY = {
  magenta: '#E5117A',
  magentaDeep: '#B3125A',
  ink: '#3B0A22',
};

function qrLabel(settings: CustomerDisplaySettings): string {
  switch (settings.qrType) {
    case 'instagram': return 'Suivez-nous sur Instagram';
    case 'tiktok': return 'Retrouvez-nous sur TikTok';
    case 'google_review': return 'Laissez un avis Google';
    case 'loyalty': return 'Rejoignez le programme fidélité';
    case 'digital_ticket': return 'Votre ticket digital';
    case 'jackpot': return 'Tentez votre chance';
    default: return 'Scannez-nous';
  }
}

/** ── IDLE / ATTRACT ── vidéo promo plein écran, sinon branding lumineux. */
function IdleScreen({ settings, videoUrl }: { settings: CustomerDisplaySettings; videoUrl: string | null }) {
  const [slide, setSlide] = useState(0);
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => setVideoFailed(false), [videoUrl]);
  const showVideo = settings.mode !== 'branding' && !!videoUrl && !videoFailed;
  const slogans = settings.slogans.length ? settings.slogans : ["The Wesley's"];

  useEffect(() => {
    const iv = setInterval(
      () => setSlide((s) => (s + 1) % slogans.length),
      Math.max(3000, settings.idleTimeoutSeconds * 1000),
    );
    return () => clearInterval(iv);
  }, [slogans.length, settings.idleTimeoutSeconds]);

  // ── Mode vidéo : la promo prend tout l'écran, marque + invite en surimpression.
  if (showVideo) {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black cd-fade-in">
        <video
          key={videoUrl}
          className="absolute inset-0 h-full w-full object-cover"
          src={videoUrl!}
          autoPlay
          loop
          muted
          playsInline
          onError={() => {
            // eslint-disable-next-line no-console
            console.warn('[customer-display] idle video failed to load — falling back to branding');
            setVideoFailed(true);
          }}
        />
        {/* Scrims haut/bas pour lisibilité de la marque et de l'invite */}
        <div className="absolute inset-x-0 top-0 h-[26%] bg-gradient-to-b from-black/55 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-black/70 to-transparent" />
        <div className="absolute inset-0 flex flex-col items-center justify-between py-[7%] px-[8%] text-white">
          <div className="cd-drift-slow flex flex-col items-center gap-[1.4vh]">
            <WesleysWordmark tone="light" style={{ fontSize: '7vh' }} />
            <div className="flex items-center gap-[1.4vh] text-[2vh] font-bold uppercase tracking-[0.2em] text-white/85">
              <span className="h-px w-[3vh] bg-white/50" />
              <Heart style={{ width: '2vh', height: '2vh', fill: 'currentColor' }} />
              Bonbons &amp; Good Vibes
              <span className="h-px w-[3vh] bg-white/50" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-[1.6vh]">
            <span className="rounded-full bg-[#E5117A] px-[3.4vh] py-[1.4vh] text-[2.4vh] font-black uppercase tracking-wide shadow-[0_10px_30px_rgba(229,17,122,0.5)]">
              Offres du moment
            </span>
            <p className="cd-pulse text-[2.2vh] font-semibold text-white/80">Touchez l'écran pour commencer</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Mode branding : attract lumineux sans vidéo.
  const categories = [
    { icon: Candy, label: 'Bonbons' },
    { icon: CupSoda, label: 'Boissons' },
    { icon: Heart, label: 'Good Vibes' },
  ];
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-b from-[#fff1f6] via-[#ffe3ee] to-[#ffd6e6]">
      <div className="absolute inset-0 cd-drift bg-[radial-gradient(circle_at_25%_15%,rgba(229,17,122,0.14),transparent_55%),radial-gradient(circle_at_80%_85%,rgba(255,138,183,0.22),transparent_55%)]" />
      <div className="absolute inset-0 flex flex-col items-center justify-between py-[9%] px-[8%] text-center" style={{ color: WESLEY.ink }}>
        {/* Marque + tagline */}
        <div className="cd-drift-slow flex flex-col items-center gap-[2vh]">
          <WesleysWordmark tone="magenta" style={{ fontSize: '11vh' }} />
          <div className="flex items-center gap-[1.6vh] text-[2.2vh] font-black uppercase tracking-[0.18em]" style={{ color: WESLEY.magenta }}>
            <span className="h-[2px] w-[4vh] rounded-full" style={{ background: WESLEY.magenta, opacity: 0.5 }} />
            <Heart style={{ width: '2.2vh', height: '2.2vh', fill: 'currentColor' }} />
            Bonbons &amp; Good Vibes
            <span className="h-[2px] w-[4vh] rounded-full" style={{ background: WESLEY.magenta, opacity: 0.5 }} />
          </div>
        </div>

        {/* Slogan rotatif */}
        <div className="cd-drift max-w-[88%]">
          {slogans.map((s, i) => (
            <h2
              key={i}
              className={`text-[5vh] font-black leading-tight tracking-tight transition-opacity duration-1000 ${
                i === slide ? 'opacity-100' : 'hidden opacity-0'
              }`}
              style={{ color: WESLEY.ink }}
            >
              {s}
            </h2>
          ))}
        </div>

        {/* QR fidélité / réseaux */}
        {settings.showQr ? (
          <div className="flex flex-col items-center gap-[1.4vh]">
            <div className="rounded-[2.4vh] bg-white p-[1.6vh] shadow-[0_16px_40px_rgba(229,17,122,0.22)] ring-1 ring-[#E5117A]/10">
              <QRCodeSVG value={settings.qrValue || 'https://thewesleys.fr'} size={128} fgColor={WESLEY.ink} className="h-[12vh] w-[12vh]" />
            </div>
            <p className="text-[2.1vh] font-bold" style={{ color: WESLEY.magenta }}>{qrLabel(settings)}</p>
          </div>
        ) : (
          <div className="h-[12vh]" />
        )}

        {/* Catégories + invite */}
        <div className="flex flex-col items-center gap-[2.4vh]">
          <div className="flex items-center gap-[5vh]">
            {categories.map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-[0.9vh]">
                <div className="flex h-[7vh] w-[7vh] items-center justify-center rounded-full bg-white shadow-[0_8px_22px_rgba(229,17,122,0.18)]">
                  <Icon style={{ width: '3.4vh', height: '3.4vh', color: WESLEY.magenta }} />
                </div>
                <span className="text-[1.8vh] font-black uppercase tracking-wide" style={{ color: WESLEY.magenta }}>{label}</span>
              </div>
            ))}
          </div>
          <p className="cd-pulse text-[2.1vh] font-semibold" style={{ color: WESLEY.magentaDeep, opacity: 0.75 }}>
            Touchez l'écran pour commencer
          </p>
        </div>
      </div>
    </div>
  );
}

/** ── CART_ACTIVE ── panier premium : cartes blanches sur dégradé magenta. */
function CartScreen({ snapshot, settings }: { snapshot: DisplaySnapshot; settings: CustomerDisplaySettings }) {
  const visible = snapshot.items.slice(0, MAX_VISIBLE_ITEMS);
  const hidden = snapshot.items.length - visible.length;

  return (
    <div className="absolute inset-0 flex flex-col bg-gradient-to-b from-[#7a0f3a] via-[#a8114f] to-[#d11168]">
      {/* Header : logo + borne */}
      <div className="flex items-center justify-between px-[6%] py-[3.5%]">
        <WesleysWordmark tone="light" style={{ fontSize: '4.6vh' }} />
        <span className="rounded-full bg-white/15 px-[2.6vh] py-[1.1vh] text-[2vh] font-black tracking-wider text-white ring-1 ring-white/20 backdrop-blur">
          {snapshot.terminalLabel || terminalLabel(settings.terminalId)}
        </span>
      </div>

      {/* Articles */}
      <div className="flex-1 overflow-hidden px-[5%] py-[1.5%] space-y-[1.5vh]">
        {visible.map((item, idx) => (
          <div
            key={`${item.name}-${idx}`}
            className="flex items-center justify-between rounded-[2.2vh] bg-white px-[3.2vh] py-[2vh] shadow-[0_10px_30px_rgba(58,10,34,0.18)]"
            style={{ animation: `cdSlideUp 0.34s cubic-bezier(0.2,0.8,0.2,1) ${idx * 0.04}s both` }}
          >
            <div className="flex items-baseline gap-[1.4vh] min-w-0">
              <span className="text-[2.7vh] font-black tabular-nums" style={{ color: WESLEY.magenta }}>{item.quantity}×</span>
              <div className="min-w-0">
                <p className="truncate text-[2.9vh] font-bold" style={{ color: WESLEY.ink }}>{item.name}</p>
                {item.quantity > 1 && (
                  <p className="text-[1.9vh] font-medium text-[#9a6b80]">{formatPrice(item.unitPriceMinorUnits)} / unité</p>
                )}
              </div>
            </div>
            <div className="text-right shrink-0 pl-[1.6vh]">
              <p className="text-[3vh] font-black tabular-nums" style={{ color: WESLEY.ink }}>{formatPrice(item.lineTotalMinorUnits)}</p>
              {item.discountMinorUnits > 0 && (
                <p className="text-[1.9vh] font-bold text-emerald-500">-{formatPrice(item.discountMinorUnits)}</p>
              )}
            </div>
          </div>
        ))}
        {hidden > 0 && (
          <p className="pt-[0.8vh] text-center text-[2.3vh] font-bold text-white/70">+ {hidden} article(s)…</p>
        )}
      </div>

      {/* Badge fidélité */}
      {snapshot.customer && (
        <div className="mx-[5%] mb-[1.6%] flex items-center justify-between gap-[1.6vh] rounded-[2vh] bg-white/95 px-[3.2vh] py-[1.8vh] shadow-[0_8px_24px_rgba(58,10,34,0.15)]">
          <div className="flex min-w-0 items-center gap-[1.4vh]">
            <div className="flex h-[4.6vh] w-[4.6vh] shrink-0 items-center justify-center rounded-full" style={{ background: `${WESLEY.magenta}18` }}>
              <Star style={{ width: '2.8vh', height: '2.8vh', color: WESLEY.magenta, fill: WESLEY.magenta }} />
            </div>
            <p className="truncate text-[2.6vh] font-black" style={{ color: WESLEY.magenta }}>Bonjour {snapshot.customer.firstName} !</p>
          </div>
          {snapshot.customer.isFirstPurchase && (
            <span className="shrink-0 whitespace-nowrap rounded-full px-[2vh] py-[0.8vh] text-[1.8vh] font-black uppercase text-white" style={{ background: WESLEY.magenta }}>
              -5% Bienvenue
            </span>
          )}
        </div>
      )}

      {/* Total */}
      <div className="mx-[5%] mb-[5%] rounded-[2.6vh] bg-white px-[4vh] py-[3vh] shadow-[0_16px_40px_rgba(58,10,34,0.25)]">
        {snapshot.totalDiscountMinorUnits > 0 && (
          <div className="mb-[1.6vh] flex justify-between text-[2.4vh] font-bold text-emerald-500">
            <span>Remise totale</span>
            <span>-{formatPrice(snapshot.totalDiscountMinorUnits)}</span>
          </div>
        )}
        <div className="flex items-end justify-between">
          <div>
            <span className="block text-[2.5vh] font-bold text-[#9a6b80]">Total à payer</span>
            <span className="text-[1.9vh] font-medium text-[#b892a2]">{snapshot.itemCount} article(s)</span>
          </div>
          <span className="text-[8.4vh] font-black leading-none tracking-tight tabular-nums" style={{ color: WESLEY.magenta }}>
            {formatPrice(snapshot.totalMinorUnits)}
          </span>
        </div>
      </div>
    </div>
  );
}

/** ── PAYMENT_PENDING ── */
function PaymentPendingScreen({ payment }: { payment: PaymentInfo }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[4vh] bg-gradient-to-b from-[#7a0f3a] via-[#a8114f] to-[#d11168] text-white cd-fade-in">
      <div className="flex h-[20vh] w-[20vh] items-center justify-center rounded-full bg-white/12 ring-1 ring-white/20">
        <CreditCard style={{ width: '11vh', height: '11vh' }} />
      </div>
      <div className="text-center">
        <p className="text-[3vh] font-semibold text-white/70">Montant à régler</p>
        <p className="mt-[1vh] text-[11vh] font-black leading-none tabular-nums">{formatPrice(payment.amountMinorUnits)}</p>
      </div>
      <div className="flex items-center gap-[1.6vh] rounded-full bg-white px-[4.2vh] py-[2vh]" style={{ color: WESLEY.magenta }}>
        <Loader2 className="animate-spin" style={{ width: '3.4vh', height: '3.4vh' }} />
        <span className="text-[3vh] font-black">Présentez votre carte</span>
      </div>
    </div>
  );
}

/** ── PAYMENT_SUCCESS ── */
function PaymentSuccessScreen({ payment, settings }: { payment: PaymentInfo; settings: CustomerDisplaySettings }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3vh] bg-gradient-to-b from-[#fff1f6] via-[#ffe3ee] to-[#ffd6e6] cd-fade-in" style={{ color: WESLEY.ink }}>
      <div className="relative flex items-center justify-center">
        <Sparkles className="absolute cd-pulse" style={{ width: '22vh', height: '22vh', color: `${WESLEY.magenta}22` }} />
        <CheckCircle2 className="text-emerald-500 cd-pop" style={{ width: '16vh', height: '16vh' }} />
      </div>
      <p className="text-[7.5vh] font-black leading-none" style={{ color: WESLEY.magenta }}>Merci !</p>
      <div className="text-center">
        <p className="text-[2.6vh] font-semibold text-[#9a6b80]">Montant payé</p>
        <p className="text-[5vh] font-black tabular-nums" style={{ color: WESLEY.ink }}>{formatPrice(payment.amountMinorUnits)}</p>
        {payment.changeMinorUnits > 0 && (
          <p className="mt-[1vh] text-[3vh] font-bold text-amber-500">Rendu : {formatPrice(payment.changeMinorUnits)}</p>
        )}
      </div>
      {settings.showQr && (
        <div className="mt-[1.6vh] flex flex-col items-center gap-[1.2vh]">
          <div className="rounded-[2.2vh] bg-white p-[1.4vh] shadow-[0_14px_36px_rgba(229,17,122,0.22)] ring-1 ring-[#E5117A]/10">
            <QRCodeSVG value={settings.qrValue || 'https://thewesleys.fr'} size={120} fgColor={WESLEY.ink} className="h-[11vh] w-[11vh]" />
          </div>
          <p className="text-[2.1vh] font-bold" style={{ color: WESLEY.magenta }}>{qrLabel(settings)}</p>
        </div>
      )}
    </div>
  );
}

/** ── PAYMENT_FAILED ── neutre, jamais d'erreur technique brute. */
function PaymentFailedScreen() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3vh] bg-gradient-to-b from-[#2a1620] to-[#120a10] text-white">
      <div className="flex h-[18vh] w-[18vh] items-center justify-center rounded-full bg-white/10">
        <CreditCard style={{ width: '10vh', height: '10vh' }} className="text-white/80" />
      </div>
      <p className="text-[4.5vh] font-black">Paiement non abouti</p>
      <p className="max-w-[72%] text-center text-[2.8vh] font-medium text-white/60">
        Merci de suivre les indications en caisse.
      </p>
    </div>
  );
}

/** ── ERROR_FALLBACK ── écran d'attente client (aucun détail technique). */
function ErrorFallbackScreen() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3vh] bg-gradient-to-b from-[#fff1f6] to-[#ffd6e6]">
      <WesleysWordmark tone="magenta" style={{ fontSize: '8vh', opacity: 0.9 }} />
      <MonitorSmartphone className="cd-pulse" style={{ width: '8vh', height: '8vh', color: `${WESLEY.magenta}66` }} />
      <p className="text-[3vh] font-bold" style={{ color: WESLEY.magentaDeep, opacity: 0.7 }}>Écran client en attente</p>
    </div>
  );
}

/** ── Identify overlay ── grand label borne pour repérage terrain. */
function IdentifyOverlay({ settings }: { settings: CustomerDisplaySettings }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-[4vh] px-[6%] text-center text-white" style={{ background: WESLEY.magenta }}>
      <WesleysWordmark tone="light" style={{ fontSize: '7vh' }} />
      <p className="cd-pulse text-[3vh] font-black uppercase tracking-[0.25em] text-white/85">Écran client</p>
      <p className="text-[7.5vh] font-black leading-[0.95] tracking-tight break-words">
        {terminalLabel(settings.terminalId)}
      </p>
      <p className="text-[2.6vh] font-semibold text-white/80">{settings.storeName}</p>
    </div>
  );
}

/** ── Test pattern (mire 9:16) ── */
function TestPatternOverlay() {
  const [res, setRes] = useState('');
  useEffect(() => {
    const update = () => setRes(`${window.innerWidth} × ${window.innerHeight}`);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return (
    <div className="absolute inset-0 z-50 bg-black">
      <div className="absolute inset-0 grid grid-cols-6 grid-rows-12">
        {Array.from({ length: 72 }).map((_, i) => (
          <div key={i} className="border border-white/20" />
        ))}
      </div>
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-[#E5117A]/70" />
      <div className="absolute top-1/2 left-0 w-full h-px -translate-y-1/2 bg-[#E5117A]/70" />
      {(['top-4 left-4', 'top-4 right-4', 'bottom-4 left-4', 'bottom-4 right-4'] as const).map((pos) => (
        <div key={pos} className={`absolute ${pos} h-16 w-16 border-4 border-[#E5117A]`} />
      ))}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
        <p className="text-[3vh] font-black tracking-widest">MIRE 9:16</p>
        <p className="text-[2.4vh] font-mono">{res}</p>
      </div>
    </div>
  );
}

export function ClientDisplayPage() {
  const { settings, snapshot, payment, state, overlay, videoUrl } = useCustomerDisplay();

  const renderState = () => {
    switch (state) {
      case 'off':
        return <div className="absolute inset-0 bg-black" />;
      case 'idle':
        return <IdleScreen settings={settings} videoUrl={videoUrl} />;
      case 'cart_active':
        return <CartScreen snapshot={snapshot} settings={settings} />;
      case 'payment_pending':
        return <PaymentPendingScreen payment={payment} />;
      case 'payment_success':
        return <PaymentSuccessScreen payment={payment} settings={settings} />;
      case 'payment_failed':
        return <PaymentFailedScreen />;
      case 'error_fallback':
        return <ErrorFallbackScreen />;
      default:
        return <ErrorFallbackScreen />;
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black">
      {/* 9:16 stage — toujours portrait, letterboxé sur fenêtre non-portrait */}
      <div className="relative h-full max-h-screen aspect-[9/16] max-w-full overflow-hidden bg-black shadow-2xl">
        {renderState()}

        {/* Overlays diagnostic/identify au-dessus de tout état */}
        {overlay.kind === 'identify' && <IdentifyOverlay settings={settings} />}
        {overlay.kind === 'test_pattern' && <TestPatternOverlay />}
      </div>

      <style>{`
        @keyframes cdSlideUp { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes cdDrift { 0%,100% { transform: translate(0,0); } 50% { transform: translate(0, -1.2%); } }
        @keyframes cdDriftSlow { 0%,100% { transform: translate(0,0); } 50% { transform: translate(0, 1.5%); } }
        @keyframes cdFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cdPop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.12); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes cdPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
        .cd-drift { animation: cdDrift 14s ease-in-out infinite; }
        .cd-drift-slow { animation: cdDriftSlow 22s ease-in-out infinite; }
        .cd-fade-in { animation: cdFadeIn 0.45s ease-out; }
        .cd-pop { animation: cdPop 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
        .cd-pulse { animation: cdPulse 2.4s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
