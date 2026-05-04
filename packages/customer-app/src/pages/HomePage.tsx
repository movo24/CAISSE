import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ChevronRight, Clock } from 'lucide-react';
import { meApi, loyaltyApi } from '../services/api';

export function HomePage() {
  const [me, setMe] = useState<any>(null);
  const [card, setCard] = useState<any>(null);

  useEffect(() => {
    Promise.all([meApi.get(), loyaltyApi.getCard()])
      .then(([m, c]) => {
        setMe(m);
        setCard(c);
      })
      .catch(() => {});
  }, []);

  const hi = me?.firstName ? `Salut ${me.firstName}` : 'Salut';

  return (
    <div className="page">
      <header style={{ marginBottom: 24 }}>
        <p className="muted" style={{ fontSize: 14 }}>The Wesley Club</p>
        <h1 className="h1" style={{ marginTop: 4 }}>{hi} 👋</h1>
      </header>

      {/* Active coupon hero */}
      {card?.activeCoupon ? (
        <Link to="/card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div
            className="glass-card"
            style={{
              borderRadius: 24,
              background: 'var(--ai-gradient)',
              backgroundSize: '200% 200%',
              animation: 'shimmer 6s ease-in-out infinite',
              padding: 24,
              marginBottom: 16,
              boxShadow: '0 12px 32px rgba(99,102,241,0.4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Sparkles size={18} color="white" />
              <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 1, color: 'rgba(255,255,255,0.9)' }}>
                AVANTAGE DISPONIBLE
              </span>
            </div>
            <p style={{ fontSize: 56, fontWeight: 800, color: 'white', letterSpacing: '-0.04em' }}>
              −{card.activeCoupon.discountPercent}%
            </p>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 4 }}>
              {card.activeCoupon.type === 'WELCOME'
                ? 'Coupon de bienvenue · présente ta carte en caisse'
                : 'Avantage fidélité · présente ta carte en caisse'}
            </p>
          </div>
        </Link>
      ) : (
        <div className="glass glass-card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Clock size={18} className="muted" />
            <span className="muted" style={{ fontSize: 13, fontWeight: 600, letterSpacing: 1 }}>
              PROCHAIN AVANTAGE
            </span>
          </div>
          {card?.nextReward?.eligible ? (
            <p style={{ fontSize: 18, fontWeight: 600 }}>
              À récupérer en magasin
            </p>
          ) : (
            <>
              <p style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>
                Dans {card?.nextReward?.daysRemaining ?? '—'} jour{(card?.nextReward?.daysRemaining ?? 0) > 1 ? 's' : ''}
              </p>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Reviens régulièrement pour profiter de tes avantages
              </p>
            </>
          )}
        </div>
      )}

      {/* Quick actions */}
      <Link to="/card" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div
          className="glass glass-card"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}
        >
          <div>
            <p style={{ fontWeight: 600 }}>Afficher ma carte</p>
            <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Présente ton QR au caissier
            </p>
          </div>
          <ChevronRight className="muted" />
        </div>
      </Link>

      <Link to="/rewards" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div
          className="glass glass-card"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <div>
            <p style={{ fontWeight: 600 }}>Mes avantages</p>
            <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {me?.visitCount ?? 0} passage{(me?.visitCount ?? 0) > 1 ? 's' : ''} en magasin
            </p>
          </div>
          <ChevronRight className="muted" />
        </div>
      </Link>
    </div>
  );
}
