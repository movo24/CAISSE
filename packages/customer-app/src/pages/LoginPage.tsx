import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi, setTokens } from '../services/api';

export function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await authApi.login(email, password);
      await setTokens(res.accessToken, res.refreshToken);
      nav('/', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erreur de connexion');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ marginBottom: 40, textAlign: 'center' }}>
        <h1 className="gradient-text" style={{ fontSize: 36, marginBottom: 8 }}>
          The Wesley Club
        </h1>
        <p className="muted">Carte fidélité et avantages magasin</p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
          placeholder="Mot de passe"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p style={{ color: '#FF6B9D', fontSize: 13, textAlign: 'center' }}>{error}</p>
        )}
        <button type="submit" className="btn-ai" disabled={busy}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>

      <p style={{ marginTop: 24, textAlign: 'center', fontSize: 14 }}>
        <Link to="/register" style={{ color: 'var(--ai-3)', textDecoration: 'none', fontWeight: 600 }}>
          Pas de compte ? Créer mon compte
        </Link>
      </p>
    </div>
  );
}
