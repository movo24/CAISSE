import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Shield, FileText, Trash2 } from 'lucide-react';
import { meApi, clearTokens } from '../services/api';

export function ProfilePage() {
  const nav = useNavigate();
  const [me, setMe] = useState<any>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    meApi.get().then(setMe).catch(() => {});
  }, []);

  async function handleLogout() {
    await clearTokens();
    nav('/login', { replace: true });
  }

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    try {
      await meApi.delete();
      await clearTokens();
      nav('/login', { replace: true });
    } catch (err) {
      alert('Erreur — réessaie plus tard');
    }
  }

  return (
    <div className="page">
      <h1 className="h1" style={{ marginBottom: 20 }}>Profil</h1>

      {/* Identity */}
      <div className="glass glass-card" style={{ marginBottom: 16, textAlign: 'center', padding: 28 }}>
        <div
          style={{
            width: 72,
            height: 72,
            margin: '0 auto 12px',
            borderRadius: '50%',
            background: 'var(--ai-gradient)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 28,
            fontWeight: 700,
            color: 'white',
          }}
        >
          {(me?.firstName?.[0] ?? 'W').toUpperCase()}
        </div>
        <p className="h2">{me?.firstName ?? 'Wesley'}</p>
        <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>{me?.email}</p>
        <p className="subtle" style={{ fontSize: 12, marginTop: 8 }}>
          {me?.visitCount ?? 0} passage{(me?.visitCount ?? 0) > 1 ? 's' : ''} en magasin
        </p>
      </div>

      {/* Links */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <a
          href="https://thewesley.com/privacy"
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <div
            className="glass glass-card"
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16 }}
          >
            <Shield size={20} className="muted" />
            <span style={{ fontWeight: 500 }}>Politique de confidentialité</span>
          </div>
        </a>

        <a
          href="https://thewesley.com/terms"
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <div
            className="glass glass-card"
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16 }}
          >
            <FileText size={20} className="muted" />
            <span style={{ fontWeight: 500 }}>Conditions d'utilisation</span>
          </div>
        </a>

        <button
          onClick={handleLogout}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div
            className="glass glass-card"
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16 }}
          >
            <LogOut size={20} className="muted" />
            <span style={{ fontWeight: 500 }}>Se déconnecter</span>
          </div>
        </button>
      </div>

      {/* Delete account (RGPD obligatoire iOS) */}
      <div style={{ marginTop: 32 }}>
        <button
          onClick={handleDelete}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <div
            className="glass glass-card"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              borderColor: 'rgba(255, 107, 157, 0.3)',
            }}
          >
            <Trash2 size={20} style={{ color: '#FF6B9D' }} />
            <span style={{ color: '#FF6B9D', fontWeight: 500 }}>
              {confirming ? 'Confirmer la suppression du compte' : 'Supprimer mon compte'}
            </span>
          </div>
        </button>
        {confirming && (
          <p className="subtle" style={{ fontSize: 12, marginTop: 8, padding: '0 8px' }}>
            Cette action est définitive. Tes données seront anonymisées sous 30 jours.
          </p>
        )}
      </div>

      <p className="subtle" style={{ textAlign: 'center', fontSize: 11, marginTop: 32 }}>
        The Wesley Club v0.1.0
      </p>
    </div>
  );
}
