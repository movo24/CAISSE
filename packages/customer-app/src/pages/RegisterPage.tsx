import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { authApi, setTokens } from '../services/api';

export function RegisterPage() {
  const nav = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Mot de passe : 8 caractères minimum');
      return;
    }
    setBusy(true);
    try {
      const res = await authApi.register({ email, password, firstName });
      await setTokens(res.accessToken, res.refreshToken);
      nav('/', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erreur création de compte');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="glass glass-card" style={{ marginBottom: 20, textAlign: 'center' }}>
        <Sparkles size={32} style={{ stroke: 'url(#ai-grad)' }} />
        <h2 className="h2" style={{ marginTop: 8 }}>
          Bienvenue —5% offert
        </h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          Crée ton compte et reçois un avantage immédiat
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input
          className="input"
          type="text"
          placeholder="Prénom"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
        <input
          className="input"
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Mot de passe (8 caractères min.)"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p style={{ color: '#FF6B9D', fontSize: 13, textAlign: 'center' }}>{error}</p>
        )}
        <button type="submit" className="btn-ai" disabled={busy}>
          {busy ? 'Création…' : 'Créer mon compte'}
        </button>
      </form>

      <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13 }} className="subtle">
        En créant ton compte tu acceptes nos{' '}
        <a href="https://thewesley.com/terms" style={{ color: 'var(--text-muted)' }}>
          conditions
        </a>{' '}
        et notre{' '}
        <a href="https://thewesley.com/privacy" style={{ color: 'var(--text-muted)' }}>
          politique de confidentialité
        </a>
        .
      </p>

      <p style={{ marginTop: 20, textAlign: 'center', fontSize: 14 }}>
        <Link to="/login" style={{ color: 'var(--ai-3)', textDecoration: 'none', fontWeight: 600 }}>
          Déjà un compte ? Se connecter
        </Link>
      </p>
    </div>
  );
}
