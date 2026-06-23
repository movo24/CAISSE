/**
 * MobileAuthGuard — audience isolation + token revocation.
 *
 * Audience: a mobile token MUST carry aud='mobile-app'; employee/no-aud/wrong-secret/
 * alg=none tokens are rejected (employee tokens can never reach mobile routes).
 * Revocation: logout / soft-delete bump the customer's tokenVersion (`tv`), so a
 * previously-issued token is rejected; a soft-deleted account is rejected outright.
 * Runs on pg-mem; Stripe/loyalty/coupon collaborators are not needed here.
 */
import './helpers/env-setup';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@nestjs/common';
import { createPgMemDataSource } from './helpers/pgmem';
import { MobileAuthGuard } from '../src/common/guards/mobile-auth.guard';
import { MobileAuthService } from '../src/modules/mobile-auth/mobile-auth.service';
import { CustomerEntity } from '../src/database/entities/customer.entity';

const SECRET = 'a-test-secret-at-least-32-chars-long-xx';

describe('MobileAuthGuard — audience isolation + revocation', () => {
  let ds: DataSource;
  let repo: Repository<CustomerEntity>;
  let guard: MobileAuthGuard;
  let svc: MobileAuthService;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    process.env.JWT_REFRESH_SECRET = SECRET;
    const { dataSource } = createPgMemDataSource();
    ds = await dataSource.initialize();
    repo = ds.getRepository(CustomerEntity);
    guard = new MobileAuthGuard(repo as any);
    // logout/deleteMe only touch customerRepo; loyalty/coupon are unused here.
    svc = new MobileAuthService(repo as any, {} as any, {} as any);
  });
  afterAll(async () => { await ds?.destroy(); });
  beforeEach(async () => { await ds.query('DELETE FROM customers'); });

  const seedCustomer = async (over: Partial<CustomerEntity> = {}) => {
    const id = uuidv4();
    await repo.save({
      id, firstName: 'A', lastName: '', email: `${id}@x.c`, qrCode: `qr-${id}`,
      loyaltyPoints: 0, isFirstPurchase: true, isVerified: false, tokenVersion: 0, ...over,
    } as any);
    return id;
  };
  const access = (sub: string, tv: number, opts: jwt.SignOptions = {}) =>
    jwt.sign({ sub, email: 'a@x.c', tv }, SECRET, { audience: 'mobile-app', expiresIn: '15m', ...opts });
  const ctx = (auth?: string) => {
    const req: any = { headers: auth ? { authorization: auth } : {} };
    return [{ switchToHttp: () => ({ getRequest: () => req }) } as any, req] as const;
  };

  describe('audience isolation', () => {
    it('accepts a valid mobile token for an existing customer and exposes only the id', async () => {
      const id = await seedCustomer();
      const [c, req] = ctx(`Bearer ${access(id, 0)}`);
      await expect(guard.canActivate(c)).resolves.toBe(true);
      expect(req.customer).toEqual({ id });
    });
    it('rejects an employee-style token with NO aud claim', async () => {
      const id = await seedCustomer();
      const tok = jwt.sign({ sub: id }, SECRET, { expiresIn: '15m' });
      await expect(guard.canActivate(ctx(`Bearer ${tok}`)[0])).rejects.toBeInstanceOf(UnauthorizedException);
    });
    it('rejects a token with a different audience (employee-app)', async () => {
      const id = await seedCustomer();
      const tok = jwt.sign({ sub: id }, SECRET, { audience: 'employee-app', expiresIn: '15m' });
      await expect(guard.canActivate(ctx(`Bearer ${tok}`)[0])).rejects.toBeInstanceOf(UnauthorizedException);
    });
    it('rejects wrong-secret and alg=none tokens', async () => {
      const id = await seedCustomer();
      const wrong = jwt.sign({ sub: id, tv: 0 }, 'another-secret-also-32-chars-long-xxxx', { audience: 'mobile-app' });
      const none = jwt.sign({ sub: id, aud: 'mobile-app', tv: 0 }, '', { algorithm: 'none' as any });
      await expect(guard.canActivate(ctx(`Bearer ${wrong}`)[0])).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(guard.canActivate(ctx(`Bearer ${none}`)[0])).rejects.toBeInstanceOf(UnauthorizedException);
    });
    it('rejects a missing / malformed Authorization header', async () => {
      await expect(guard.canActivate(ctx(undefined)[0])).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(guard.canActivate(ctx('Token xyz')[0])).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('revocation', () => {
    it('rejects a token after logout bumps tokenVersion', async () => {
      const id = await seedCustomer();
      const token = access(id, 0);
      await expect(guard.canActivate(ctx(`Bearer ${token}`)[0])).resolves.toBe(true);
      await svc.logout(id); // tokenVersion 0 → 1
      await expect(guard.canActivate(ctx(`Bearer ${token}`)[0])).rejects.toThrow(/révoqué/);
      // a freshly-minted token (tv=1) works again
      await expect(guard.canActivate(ctx(`Bearer ${access(id, 1)}`)[0])).resolves.toBe(true);
    });
    it('rejects any token for a soft-deleted account', async () => {
      const id = await seedCustomer();
      await svc.deleteMe(id); // sets deletedAt + bumps tv
      await expect(guard.canActivate(ctx(`Bearer ${access(id, 0)}`)[0])).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(guard.canActivate(ctx(`Bearer ${access(id, 1)}`)[0])).rejects.toBeInstanceOf(UnauthorizedException);
    });
    it('rejects a token whose customer no longer exists', async () => {
      await expect(guard.canActivate(ctx(`Bearer ${access(uuidv4(), 0)}`)[0])).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refresh revocation', () => {
    it('a refresh token cannot mint new tokens after logout', async () => {
      const id = await seedCustomer();
      const refresh = jwt.sign({ sub: id, tv: 0 }, SECRET, { audience: 'mobile-app', expiresIn: '30d' });
      await expect(svc.refresh(refresh)).resolves.toHaveProperty('accessToken');
      await svc.logout(id);
      await expect(svc.refresh(refresh)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
