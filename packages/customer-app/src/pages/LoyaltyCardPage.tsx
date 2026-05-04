import { useEffect, useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { loyaltyApi } from '../services/api';

export function LoyaltyCardPage() {
  const [card, setCard] = useState<any>(null);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [loading, setLoading] = useState(false);

  const refreshCard = useCallback(async () => {
    setLoading(true);
    try {
      const c = await loyaltyApi.getCard();
      setCard(c);
      const expIn = Math.max(
        0,
        Math.floor((new Date(c.qrTokenExpiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(expIn);
    } catch (err) {
      // ignore — auth interceptor handles 401
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCard();
  }, [refreshCard]);

  // Countdown + auto-refresh at 5s remaining
  useEffect(() => {
    if (!card) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          refreshCard();
          return 60;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [card, refreshCard]);

  return (
    <div className="page">
      <header style={{ marginBottom: 20, textAlign: 'center' }}>
        <h1 className="h1" style={{ marginBottom: 4 }}>Ta carte</h1>
        <p className="muted" style={{ fontSize: 14 }}>
          Présente ce QR au caissier
        </p>
      </header>

      {card?.activeCoupon && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 20px',
            borderRadius: 100,
            background: 'var(--ai-gradient-soft)',
            border: '1px solid rgba(99,102,241,0.4)',
            marginBottom: 16,
          }}
        >
          <Sparkles size={18} style={{ stroke: 'url(#ai-grad)' }} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>
            −{card.activeCoupon.discountPercent}% disponible en caisse
          </span>
        </div>
      )}

      {/* QR card */}
      <div
        className="glass-card"
        style={{
          background: 'white',
          borderRadius: 28,
          padding: 32,
          textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        {card ? (
          <>
            <div
              style={{
                background: 'white',
                padding: 16,
                borderRadius: 16,
                display: 'inline-block',
              }}
            >
              <QRCodeSVG
                value={card.qrToken}
                size={240}
                level="H"
                bgColor="#FFFFFF"
                fgColor="#0B0B10"
              />
            </div>

            <p
              style={{
                marginTop: 16,
                fontFamily: 'SF Mono, Menlo, monospace',
                fontSize: 14,
                color: '#0B0B10',
                fontWeight: 600,
                letterSpacing: 1,
              }}
            >
              {card.publicCode}
            </p>

            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: '#888',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <RefreshCw size={11} />
              <span>QR rafraîchi dans {secondsLeft}s</span>
            </div>
          </>
        ) : (
          <p style={{ color: '#888' }}>{loading ? 'Chargement…' : 'Aucune carte'}</p>
        )}
      </div>

      {card?.nextReward && !card.activeCoupon && !card.nextReward.eligible && (
        <div className="glass glass-card" style={{ marginTop: 16 }}>
          <p className="muted" style={{ fontSize: 13 }}>
            Prochain avantage dans{' '}
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>
              {card.nextReward.daysRemaining} jour
              {card.nextReward.daysRemaining > 1 ? 's' : ''}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
