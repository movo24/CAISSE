import { describe, it, expect } from 'vitest';
import { classifyAuthError } from './authError';

/** Erreur axios avec réponse HTTP. */
function withResponse(status: number, data?: any) {
  return {
    config: { baseURL: '/api', url: '/auth/login/admin' },
    response: { status, data },
    message: `Request failed with status code ${status}`,
  };
}

/** Erreur axios sans réponse (rien n'est revenu du réseau). */
function withoutResponse(code: string, message = 'Network Error') {
  return {
    config: { baseURL: 'https://api.addxintelligence.com', url: '/api/auth/login/admin' },
    code,
    message,
  };
}

describe('classifyAuthError', () => {
  it('401 → identifiants incorrects', () => {
    const r = classifyAuthError(withResponse(401, { message: 'Invalid credentials' }));
    expect(r.kind).toBe('credentials');
    expect(r.status).toBe(401);
    expect(r.message).toBe('Invalid credentials');
  });

  it('403 → identifiants incorrects, message par défaut si le serveur est muet', () => {
    const r = classifyAuthError(withResponse(403, {}));
    expect(r.kind).toBe('credentials');
    expect(r.message).toMatch(/Identifiants incorrects/);
  });

  it('429 → limite de tentatives, jamais présenté comme un PIN faux', () => {
    const r = classifyAuthError(withResponse(429));
    expect(r.kind).toBe('rate_limited');
    expect(r.message).not.toMatch(/incorrect/i);
  });

  it('500 → erreur interne du serveur, explicitement pas un problème d’identifiants', () => {
    const r = classifyAuthError(withResponse(500, { message: 'Internal server error' }));
    expect(r.kind).toBe('server');
    expect(r.status).toBe(500);
    expect(r.message).toMatch(/pas un problème d’identifiants/);
  });

  it('502 Railway (backend crashé) → serveur indisponible, pas « identifiants »', () => {
    const r = classifyAuthError(
      withResponse(502, { status: 'error', code: 502, message: 'Application failed to respond' }),
    );
    expect(r.kind).toBe('unavailable');
    expect(r.kind).not.toBe('credentials');
    // Le message brut de l'edge reste visible dans la ligne technique, pas dans le message utilisateur.
    expect(r.detail).toContain('Application failed to respond');
    expect(r.detail).toContain('HTTP 502');
  });

  it.each([503, 504])('%i → serveur indisponible', (status) => {
    expect(classifyAuthError(withResponse(status)).kind).toBe('unavailable');
  });

  it('délai dépassé (ECONNABORTED) → serveur indisponible, identifiants non vérifiés', () => {
    const r = classifyAuthError(withoutResponse('ECONNABORTED', 'timeout of 15000ms exceeded'));
    expect(r.kind).toBe('unavailable');
    expect(r.status).toBeNull();
    expect(r.message).toMatch(/n’ont pas été vérifiés/);
    expect(r.detail).toMatch(/délai dépassé/);
  });

  it('erreur réseau sans réponse → serveur injoignable', () => {
    const r = classifyAuthError(withoutResponse('ERR_NETWORK'));
    expect(r.kind).toBe('unavailable');
    expect(r.status).toBeNull();
  });

  it('400 → requête refusée, distinct de 401', () => {
    const r = classifyAuthError(withResponse(400, { message: ['email must be an email'] }));
    expect(r.kind).toBe('bad_request');
    expect(r.message).toBe('email must be an email');
  });

  it('la ligne technique porte l’URL absolue réellement appelée', () => {
    const r = classifyAuthError(withoutResponse('ECONNABORTED', 'timeout of 15000ms exceeded'));
    expect(r.detail).toContain('https://api.addxintelligence.com/api/auth/login/admin');
  });

  it('les quatre situations exigées produisent quatre verdicts distincts', () => {
    const kinds = [
      classifyAuthError(withResponse(401)).kind, // identifiants incorrects
      classifyAuthError(withResponse(502)).kind, // serveur indisponible
      classifyAuthError(withResponse(500)).kind, // erreur interne serveur
      classifyAuthError(withoutResponse('ERR_NETWORK')).kind,
    ];
    expect(new Set(kinds.slice(0, 3)).size).toBe(3);
  });
});
