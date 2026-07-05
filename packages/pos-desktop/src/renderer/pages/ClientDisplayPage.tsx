import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Star, CheckCircle2, CreditCard, Loader2, MonitorSmartphone } from 'lucide-react';
import { useCustomerDisplay } from '../hooks/useCustomerDisplay';
import { formatPrice, type DisplaySnapshot } from '../services/customerDisplay/snapshot';
import { terminalLabel, type CustomerDisplaySettings } from '../services/customerDisplay/settings';
import type { PaymentInfo } from '../hooks/useCustomerDisplay';

/**
 * Customer Display (screen 2) — vertical 9:16.
 *
 * A dedicated, non-touch customer-facing screen. Renders a single state derived
 * by the pure machine (OFF / IDLE / CART_ACTIVE / PAYMENT_* / ERROR_FALLBACK)
 * plus identify/diagnostic overlays. Strictly read-only: it mirrors the cart
 * and payment the operator drives, and can never mutate them.
 *
 * The design is a fixed 9:16 "stage" centered in the window, so it always keeps
 * the 1080×1920 aspect on any resolution (720×1280, 1440×2560…) — never
 * stretched horizontally, and letterboxed on non-portrait dev windows.
 */

const MAX_VISIBLE_ITEMS = 8;

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

/** ── IDLE ── video / branding loop with anti-burn-in drift. */
function IdleScreen({ settings, videoUrl }: { settings: CustomerDisplaySettings; videoUrl: string | null }) {
  const [slide, setSlide] = useState(0);
  // A corrupt/undecodable video fires onError; we then fall back to branding and
  // do NOT re-mount the <video>, so a broken source can't loop errors forever.
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

  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-[#1a0b2e] via-[#0f0a1f] to-black">
      {showVideo ? (
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
      ) : (
        // Fallback gradient when no video / branding mode — with slow drift.
        <div className="absolute inset-0 cd-drift bg-[radial-gradient(circle_at_30%_20%,rgba(236,72,153,0.25),transparent_60%),radial-gradient(circle_at_70%_80%,rgba(99,102,241,0.25),transparent_60%)]" />
      )}

      {/* Safe-zone overlay: logo + rotating slogan, gently drifting to avoid burn-in */}
      <div className="absolute inset-0 flex flex-col items-center justify-between py-[8%] px-[8%] text-white">
        <div className="cd-drift-slow text-center">
          <p className="text-[3.2vh] font-black tracking-tight drop-shadow-lg">{settings.storeName}</p>
        </div>

        <div className="cd-drift text-center max-w-[85%]">
          {slogans.map((s, i) => (
            <h2
              key={i}
              className={`text-[4.4vh] font-black leading-tight tracking-tight transition-opacity duration-1000 drop-shadow-2xl ${
                i === slide ? 'opacity-100' : 'hidden opacity-0'
              }`}
            >
              {s}
            </h2>
          ))}
        </div>

        {settings.showQr ? (
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-3xl bg-white p-[1.6vh] shadow-2xl">
              <QRCodeSVG value={settings.qrValue || 'https://thewesleys.fr'} size={128} className="h-[13vh] w-[13vh]" />
            </div>
            <p className="text-[2.2vh] font-semibold text-white/80">{qrLabel(settings)}</p>
          </div>
        ) : (
          <div className="h-[13vh]" />
        )}
      </div>
    </div>
  );
}

/** ── CART_ACTIVE (also the ticket backdrop during PAYMENT_PENDING) ── */
function CartScreen({ snapshot, settings }: { snapshot: DisplaySnapshot; settings: CustomerDisplaySettings }) {
  const visible = snapshot.items.slice(0, MAX_VISIBLE_ITEMS);
  const hidden = snapshot.items.length - visible.length;

  return (
    <div className="absolute inset-0 flex flex-col bg-gradient-to-b from-[#0f0a1f] to-black text-white">
      {/* Header: store + terminal */}
      <div className="flex items-center justify-between px-[6%] py-[3.5%] border-b border-white/10">
        <div>
          <p className="text-[3vh] font-black tracking-tight">{snapshot.storeName || settings.storeName}</p>
        </div>
        <span className="rounded-full bg-white/10 px-[2.4vh] py-[1vh] text-[2vh] font-bold tracking-wider text-white/70">
          {snapshot.terminalLabel || terminalLabel(settings.terminalId)}
        </span>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-hidden px-[5%] py-[3%] space-y-[1.4vh]">
        {visible.map((item, idx) => (
          <div
            key={`${item.name}-${idx}`}
            className="flex items-center justify-between rounded-2xl bg-white/[0.05] px-[3.2vh] py-[1.8vh] border border-white/[0.06]"
            style={{ animation: `cdSlideUp 0.3s ease-out ${idx * 0.03}s both` }}
          >
            <div className="flex items-baseline gap-3 min-w-0">
              <span className="text-[2.6vh] font-bold text-white/50 tabular-nums">{item.quantity}×</span>
              <div className="min-w-0">
                <p className="truncate text-[2.8vh] font-semibold">{item.name}</p>
                {item.quantity > 1 && (
                  <p className="text-[1.9vh] text-white/40">{formatPrice(item.unitPriceMinorUnits)} / unité</p>
                )}
              </div>
            </div>
            <div className="text-right shrink-0 pl-3">
              <p className="text-[2.9vh] font-bold tabular-nums">{formatPrice(item.lineTotalMinorUnits)}</p>
              {item.discountMinorUnits > 0 && (
                <p className="text-[1.9vh] font-medium text-emerald-400">-{formatPrice(item.discountMinorUnits)}</p>
              )}
            </div>
          </div>
        ))}
        {hidden > 0 && (
          <p className="pt-[1vh] text-center text-[2.3vh] font-semibold text-white/40">+ {hidden} article(s)…</p>
        )}
      </div>

      {/* Loyalty badge */}
      {snapshot.customer && (
        <div className="mx-[5%] mb-[2%] rounded-2xl border border-violet-500/20 bg-violet-500/10 px-[3.2vh] py-[1.6vh]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Star className="text-violet-300" style={{ width: '3vh', height: '3vh' }} />
              <p className="text-[2.5vh] font-semibold text-violet-200">Bonjour {snapshot.customer.firstName} !</p>
            </div>
            {snapshot.customer.isFirstPurchase && (
              <span className="rounded-full bg-emerald-500 px-[1.8vh] py-[0.7vh] text-[1.7vh] font-bold uppercase text-white">
                -5% Bienvenue
              </span>
            )}
          </div>
        </div>
      )}

      {/* Total */}
      <div className="border-t border-white/10 bg-white/[0.04] px-[6%] py-[4%]">
        {snapshot.totalDiscountMinorUnits > 0 && (
          <div className="mb-[1.4vh] flex justify-between text-[2.4vh] text-emerald-400">
            <span>Remise totale</span>
            <span className="font-semibold">-{formatPrice(snapshot.totalDiscountMinorUnits)}</span>
          </div>
        )}
        <div className="flex items-end justify-between">
          <div>
            <span className="block text-[2.4vh] font-medium text-white/50">Total à payer</span>
            <span className="text-[1.9vh] text-white/30">{snapshot.itemCount} article(s)</span>
          </div>
          <span className="text-[8vh] font-black leading-none tracking-tight tabular-nums">
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
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[4vh] bg-gradient-to-br from-[#0b1a2e] via-[#0f0a1f] to-black text-white">
      <CreditCard className="text-pos-accent-alt" style={{ width: '12vh', height: '12vh' }} />
      <div className="text-center">
        <p className="text-[3vh] font-medium text-white/60">Montant à régler</p>
        <p className="mt-[1vh] text-[11vh] font-black leading-none tabular-nums">
          {formatPrice(payment.amountMinorUnits)}
        </p>
      </div>
      <div className="flex items-center gap-3 rounded-full bg-white/10 px-[4vh] py-[2vh]">
        <Loader2 className="animate-spin" style={{ width: '3.4vh', height: '3.4vh' }} />
        <span className="text-[3vh] font-semibold">Présentez votre carte</span>
      </div>
    </div>
  );
}

/** ── PAYMENT_SUCCESS ── */
function PaymentSuccessScreen({ payment, settings }: { payment: PaymentInfo; settings: CustomerDisplaySettings }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3vh] bg-gradient-to-br from-[#0b2e1a] via-[#0f1f14] to-black text-white cd-fade-in">
      <CheckCircle2 className="text-emerald-400 cd-pop" style={{ width: '16vh', height: '16vh' }} />
      <p className="text-[7vh] font-black leading-none">Merci !</p>
      <div className="text-center">
        <p className="text-[2.6vh] text-white/60">Montant payé</p>
        <p className="text-[5vh] font-bold tabular-nums">{formatPrice(payment.amountMinorUnits)}</p>
        {payment.changeMinorUnits > 0 && (
          <p className="mt-[1vh] text-[3vh] text-amber-300">Rendu : {formatPrice(payment.changeMinorUnits)}</p>
        )}
      </div>
      {settings.showQr && (
        <div className="mt-[2vh] flex flex-col items-center gap-3">
          <div className="rounded-3xl bg-white p-[1.4vh] shadow-2xl">
            <QRCodeSVG value={settings.qrValue || 'https://thewesleys.fr'} size={120} className="h-[12vh] w-[12vh]" />
          </div>
          <p className="text-[2.2vh] font-semibold text-white/80">{qrLabel(settings)}</p>
        </div>
      )}
    </div>
  );
}

/** ── PAYMENT_FAILED ── neutral, never a raw technical error. */
function PaymentFailedScreen() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3vh] bg-gradient-to-br from-[#2e0b0b] via-[#1f0f0f] to-black text-white">
      <CreditCard className="text-white/70" style={{ width: '12vh', height: '12vh' }} />
      <p className="text-[4.5vh] font-black">Paiement non abouti</p>
      <p className="max-w-[70%] text-center text-[2.8vh] text-white/60">
        Merci de suivre les indications en caisse.
      </p>
    </div>
  );
}

/** ── ERROR_FALLBACK ── customer-safe "waiting" screen (no technical detail). */
function ErrorFallbackScreen({ settings }: { settings: CustomerDisplaySettings }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3vh] bg-black text-white">
      <MonitorSmartphone className="text-white/40 cd-pulse" style={{ width: '10vh', height: '10vh' }} />
      <p className="text-[3.4vh] font-semibold text-white/70">Écran client en attente</p>
      <p className="text-[2.4vh] text-white/30">{settings.storeName}</p>
    </div>
  );
}

/** ── Identify overlay ── giant terminal label for field identification. */
function IdentifyOverlay({ settings }: { settings: CustomerDisplaySettings }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-[4vh] bg-pos-accent px-[6%] text-center text-white">
      <p className="cd-pulse text-[3vh] font-bold uppercase tracking-[0.25em] text-white/80">Écran client</p>
      <p className="text-[7.5vh] font-black leading-[0.95] tracking-tight break-words">
        {terminalLabel(settings.terminalId)}
      </p>
      <p className="text-[2.6vh] text-white/70">{settings.storeName}</p>
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
      {/* Center crosshair */}
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-pos-accent-alt/70" />
      <div className="absolute top-1/2 left-0 w-full h-px -translate-y-1/2 bg-pos-accent-alt/70" />
      {/* Corner markers */}
      {(['top-4 left-4', 'top-4 right-4', 'bottom-4 left-4', 'bottom-4 right-4'] as const).map((pos) => (
        <div key={pos} className={`absolute ${pos} h-16 w-16 border-4 border-pos-accent`} />
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
        return <ErrorFallbackScreen settings={settings} />;
      default:
        return <ErrorFallbackScreen settings={settings} />;
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black">
      {/* 9:16 stage — always portrait, letterboxed on non-portrait windows */}
      <div className="relative h-full max-h-screen aspect-[9/16] max-w-full overflow-hidden bg-black shadow-2xl">
        {renderState()}

        {/* Diagnostic + identify overlays sit above every state */}
        {overlay.kind === 'identify' && <IdentifyOverlay settings={settings} />}
        {overlay.kind === 'test_pattern' && <TestPatternOverlay />}
      </div>

      <style>{`
        @keyframes cdSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cdDrift { 0%,100% { transform: translate(0,0); } 50% { transform: translate(0, -1.2%); } }
        @keyframes cdDriftSlow { 0%,100% { transform: translate(0,0); } 50% { transform: translate(0, 1.5%); } }
        @keyframes cdFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cdPop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes cdPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
        .cd-drift { animation: cdDrift 14s ease-in-out infinite; }
        .cd-drift-slow { animation: cdDriftSlow 22s ease-in-out infinite; }
        .cd-fade-in { animation: cdFadeIn 0.5s ease-out; }
        .cd-pop { animation: cdPop 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
        .cd-pulse { animation: cdPulse 2.4s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
