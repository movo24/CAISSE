import { useEffect, useState } from 'react';
import { Sparkles, Check, Clock } from 'lucide-react';
import { couponApi, loyaltyApi } from '../services/api';

export function RewardsPage() {
  const [active, setActive] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [nextReward, setNextReward] = useState<any>(null);

  useEffect(() => {
    Promise.all([couponApi.active(), couponApi.history(), loyaltyApi.getCard()])
      .then(([a, h, card]) => {
        setActive(a);
        setHistory(h);
        setNextReward(card.nextReward);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="page">
      <h1 className="h1" style={{ marginBottom: 20 }}>Mes avantages</h1>

      {/* Active coupon */}
      <section style={{ marginBottom: 24 }}>
        <h2 className="h2" style={{ marginBottom: 12 }}>Avantage actif</h2>
        {active ? (
          <div
            className="glass-card"
            style={{
              borderRadius: 24,
              background: 'var(--ai-gradient)',
              backgroundSize: '200% 200%',
              animation: 'shimmer 6s ease-in-out infinite',
              padding: 24,
              boxShadow: '0 12px 32px rgba(99,102,241,0.4)',
            }}
          >
            <Sparkles size={20} color="white" />
            <p style={{ fontSize: 48, fontWeight: 800, color: 'white', marginTop: 8 }}>
              −{active.discountPercent}%
            </p>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 4 }}>
              {active.type === 'WELCOME' ? 'Bienvenue' : 'Fidélité'} · présente ta carte en caisse
            </p>
          </div>
        ) : (
          <div className="glass glass-card">
            <Clock size={20} className="muted" />
            <p style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>
              {nextReward?.eligible
                ? 'Prochain avantage : à venir au prochain passage'
                : `Prochain avantage dans ${nextReward?.daysRemaining ?? '—'} jour${
                    (nextReward?.daysRemaining ?? 0) > 1 ? 's' : ''
                  }`}
            </p>
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              Tu reçois automatiquement un coupon tous les 15 jours.
            </p>
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h2 className="h2" style={{ marginBottom: 12 }}>
          Historique ({history.length})
        </h2>
        {history.length === 0 ? (
          <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: 20 }}>
            Aucun avantage utilisé pour le moment
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map((c) => (
              <div
                key={c.id}
                className="glass glass-card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 16,
                }}
              >
                <div>
                  <p style={{ fontWeight: 600 }}>−{c.discountPercent}%</p>
                  <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {c.type === 'WELCOME' ? 'Bienvenue' : c.type === 'LOYALTY' ? 'Fidélité' : 'Cadeau'}
                    {c.usedAt && ` · ${new Date(c.usedAt).toLocaleDateString('fr')}`}
                  </p>
                </div>
                <Check size={18} className="subtle" />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* How it works */}
      <section style={{ marginTop: 32 }}>
        <h2 className="h2" style={{ marginBottom: 12 }}>Comment ça marche</h2>
        <div className="glass glass-card">
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <li className="muted" style={{ fontSize: 14 }}>
              <strong style={{ color: 'var(--text)' }}>1.</strong> Affiche ta carte en magasin
            </li>
            <li className="muted" style={{ fontSize: 14 }}>
              <strong style={{ color: 'var(--text)' }}>2.</strong> Le caissier scanne ton QR code
            </li>
            <li className="muted" style={{ fontSize: 14 }}>
              <strong style={{ color: 'var(--text)' }}>3.</strong> Ton avantage est appliqué automatiquement
            </li>
            <li className="muted" style={{ fontSize: 14 }}>
              <strong style={{ color: 'var(--text)' }}>4.</strong> Un nouvel avantage tous les 15 jours
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
}
