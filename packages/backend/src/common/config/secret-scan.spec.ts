import { findSecretLeaks } from './secret-scan';

describe('findSecretLeaks (POS-INT-226)', () => {
  it('flags a real-looking Stripe secret key', () => {
    const hits = findSecretLeaks('STRIPE_SECRET_KEY=sk_live_ABCDEFabcdef0123456789');
    expect(hits.map((h) => h.pattern)).toContain('stripe-secret');
  });

  it('flags webhook + AWS + google + jwt shapes', () => {
    expect(findSecretLeaks('X=whsec_ABCDEFabcdef0123456789').length).toBe(1);
    expect(findSecretLeaks('X=AKIA1234567890ABCDEF').length).toBe(1);
    expect(findSecretLeaks('X=AIza' + 'b'.repeat(35)).length).toBe(1);
    expect(findSecretLeaks('T=eyJabcdefghij.eyJklmnopqrst.signature123').length).toBe(1);
  });

  it('flags a postgres URL with a real password on a remote host', () => {
    expect(findSecretLeaks('DATABASE_URL=postgres://user:sup3rsecretpw@db.prod.acme.io/app').length).toBe(1);
  });

  it('tolerates documented placeholders', () => {
    expect(findSecretLeaks('OUTBOX_PUBLISH_SECRET=replace-with-shared-hmac-secret')).toEqual([]);
    expect(findSecretLeaks('DB=postgres://user:<password>@host/db')).toEqual([]);
    expect(findSecretLeaks('KEY=sk_test_xxxxxxxxxxxxxxxx')).toEqual([]);
    expect(findSecretLeaks('URL=postgres://user:password@localhost:5432/app')).toEqual([]);
  });

  it('empty / clean text → no hits', () => {
    expect(findSecretLeaks('')).toEqual([]);
    expect(findSecretLeaks('PORT=3001\nNODE_ENV=development')).toEqual([]);
  });
});
