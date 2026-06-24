/**
 * M112 — CurrencyService (service / DB layer).
 *
 * The existing currency.spec.ts covers a test-local reimplementation of the
 * formatting + conversion math. This spec exercises the REAL service against
 * pg-mem: the temporal rate lookups (latest / as-of), latest-per-pair listing,
 * setRate, and convert's rate-fetch path (NotFound + unsupported-currency).
 *
 * Note on `rate`: it is a `decimal` column, so TypeORM hydrates it as a STRING
 * on real Postgres (pg-mem may return a number). convert() now coerces it to a
 * number to honour its `rate: number` return contract — asserted below. Numeric
 * comparisons use Number()/toBeCloseTo to stay robust across both backends.
 */
import './helpers/env-setup';
import { DataSource, Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { CurrencyService } from '../src/modules/currency/currency.service';
import { FxRateEntity } from '../src/database/entities/fx-rate.entity';

describe('M112 — CurrencyService (service/DB layer)', () => {
  let ds: DataSource;
  let repo: Repository<FxRateEntity>;
  let svc: CurrencyService;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = await dataSource.initialize();
    repo = ds.getRepository(FxRateEntity);
    svc = new CurrencyService(repo);
  });
  afterAll(async () => {
    await ds?.destroy();
  });
  beforeEach(async () => {
    await ds.query('DELETE FROM fx_rates');
  });

  /** Seed a rate with an explicit timestamp (setRate can't set one). */
  const seed = (base: string, quote: string, rate: number, isoTs: string) =>
    repo.save({ id: uuidv4(), baseCurrency: base, quoteCurrency: quote, rate, source: 'manual', timestamp: new Date(isoTs) } as any);

  describe('convert', () => {
    it('same currency → identity, rate 1, no DB hit', async () => {
      const r = await svc.convert(1234, 'EUR', 'EUR');
      expect(r.amountMinorUnits).toBe(1234);
      expect(r.rate).toBe(1);
    });

    it('applies the rate, minor → minor (EUR→USD @1.1: 10.00 → 11.00)', async () => {
      await seed('EUR', 'USD', 1.1, '2026-01-01T00:00:00Z');
      const r = await svc.convert(1000, 'EUR', 'USD');
      expect(r.amountMinorUnits).toBe(1100);
      expect(typeof r.rate).toBe('number'); // decimal-as-string contract fix
    });

    it('handles a precision change EUR(2) → JPY(0) (@160: 10.00 EUR → 1600 JPY)', async () => {
      await seed('EUR', 'JPY', 160, '2026-01-01T00:00:00Z');
      const r = await svc.convert(1000, 'EUR', 'JPY');
      expect(r.amountMinorUnits).toBe(1600);
    });

    it('rounds to the nearest minor unit (EUR→USD @1.0856: 1.99 → 2.16)', async () => {
      await seed('EUR', 'USD', 1.0856, '2026-01-01T00:00:00Z');
      const r = await svc.convert(199, 'EUR', 'USD');
      expect(r.amountMinorUnits).toBe(216); // 1.99 * 1.0856 = 2.160344 → 216
    });

    it('uses the LATEST rate, not an older one', async () => {
      await seed('EUR', 'USD', 1.0, '2026-01-01T00:00:00Z');
      await seed('EUR', 'USD', 2.0, '2026-02-01T00:00:00Z');
      const r = await svc.convert(1000, 'EUR', 'USD');
      expect(r.amountMinorUnits).toBe(2000); // 10.00 * 2.0
    });

    it('throws NotFound when no rate exists for the pair', async () => {
      await expect(svc.convert(1000, 'EUR', 'USD')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws "Unsupported currency" when a rate exists but the currency config is unknown', async () => {
      await seed('EUR', 'ZZZ', 1.5, '2026-01-01T00:00:00Z');
      await expect(svc.convert(1000, 'EUR', 'ZZZ')).rejects.toThrow(/Unsupported currency/);
    });
  });

  describe('convert — exact integer precision (regression guards)', () => {
    // The service converts via BigInt; these pin EXACT minor-unit results so a
    // regression back to float64 multiplication is caught.
    it('pins high-significance conversions to exact minor units', async () => {
      await seed('EUR', 'USD', 1.0856, '2026-01-01T00:00:00Z');
      await seed('EUR', 'JPY', 160.123456, '2026-01-01T00:00:00Z');
      expect((await svc.convert(999999, 'EUR', 'USD')).amountMinorUnits).toBe(1085599); // 9999.99 €
      expect((await svc.convert(123456, 'EUR', 'JPY')).amountMinorUnits).toBe(197682); // 1234.56 €
      expect((await svc.convert(7, 'EUR', 'USD')).amountMinorUnits).toBe(8); // 0.07 €
    });

    it('rounds a large conversion like EXACT decimal, not float64 (RED on float64)', async () => {
      // ¥18,898,300 × 0.12965 = $2,450,164.60 exactly → 245016460 minor USD.
      // The float64 path yields 245016459 (off by one cent); BigInt yields 245016460.
      await seed('JPY', 'USD', 0.12965, '2026-01-01T00:00:00Z');
      expect((await svc.convert(18898300, 'JPY', 'USD')).amountMinorUnits).toBe(245016460);
    });

    it('does not accumulate drift across summed conversions', async () => {
      await seed('EUR', 'USD', 1.0856, '2026-01-01T00:00:00Z');
      const converted: number[] = [];
      for (const a of [199, 299, 399]) {
        converted.push((await svc.convert(a, 'EUR', 'USD')).amountMinorUnits);
      }
      expect(converted).toEqual([216, 325, 433]);
      expect(converted.reduce((s, x) => s + x, 0)).toBe(974);
    });
  });

  describe('getLatestRate', () => {
    it('returns the most recent rate by timestamp', async () => {
      await seed('EUR', 'USD', 1.0, '2026-01-01T00:00:00Z');
      await seed('EUR', 'USD', 1.25, '2026-03-01T00:00:00Z');
      const r = await svc.getLatestRate('EUR', 'USD');
      expect(Number(r.rate)).toBeCloseTo(1.25, 6);
    });

    it('throws NotFound when the pair has no rate', async () => {
      await expect(svc.getLatestRate('EUR', 'USD')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getRateAsOf', () => {
    it('returns the rate effective at or before the asOf instant', async () => {
      await seed('EUR', 'USD', 1.0, '2026-01-01T00:00:00Z');
      await seed('EUR', 'USD', 2.0, '2026-02-01T00:00:00Z');
      const mid = await svc.getRateAsOf('EUR', 'USD', new Date('2026-01-15T00:00:00Z'));
      expect(Number(mid.rate)).toBeCloseTo(1.0, 6); // 2.0 not yet effective
      const after = await svc.getRateAsOf('EUR', 'USD', new Date('2026-03-01T00:00:00Z'));
      expect(Number(after.rate)).toBeCloseTo(2.0, 6);
    });

    it('throws NotFound when asked before the first rate exists', async () => {
      await seed('EUR', 'USD', 1.0, '2026-02-01T00:00:00Z');
      await expect(
        svc.getRateAsOf('EUR', 'USD', new Date('2026-01-01T00:00:00Z')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getAllRates', () => {
    it('returns the latest rate per pair', async () => {
      await seed('EUR', 'USD', 1.0, '2026-01-01T00:00:00Z');
      await seed('EUR', 'USD', 2.0, '2026-02-01T00:00:00Z'); // newer EUR/USD
      await seed('EUR', 'GBP', 0.8, '2026-01-01T00:00:00Z');
      const all = await svc.getAllRates();
      expect(all).toHaveLength(2);
      const usd = all.find((r) => r.quoteCurrency === 'USD')!;
      const gbp = all.find((r) => r.quoteCurrency === 'GBP')!;
      expect(Number(usd.rate)).toBeCloseTo(2.0, 6); // latest, not 1.0
      expect(Number(gbp.rate)).toBeCloseTo(0.8, 6);
    });
  });

  describe('setRate', () => {
    it('persists a rate retrievable via getLatestRate, defaulting source to "manual"', async () => {
      const saved = await svc.setRate({ baseCurrency: 'EUR', quoteCurrency: 'AED', rate: 4.0 });
      expect(saved.source).toBe('manual');
      const latest = await svc.getLatestRate('EUR', 'AED');
      expect(Number(latest.rate)).toBeCloseTo(4.0, 6);
    });
  });
});
