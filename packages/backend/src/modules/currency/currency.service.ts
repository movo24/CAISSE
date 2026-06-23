import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FxRateEntity } from '../../database/entities/fx-rate.entity';

// Re-export currency configs for convenience
export { CURRENCY_CONFIGS } from '../../common/types/currency';

@Injectable()
export class CurrencyService {
  constructor(
    @InjectRepository(FxRateEntity)
    private fxRateRepo: Repository<FxRateEntity>,
  ) {}

  async setRate(data: {
    baseCurrency: string;
    quoteCurrency: string;
    rate: number;
    source?: string;
  }): Promise<FxRateEntity> {
    const fxRate = this.fxRateRepo.create({
      ...data,
      source: data.source || 'manual',
    });
    return this.fxRateRepo.save(fxRate);
  }

  async getLatestRate(
    baseCurrency: string,
    quoteCurrency: string,
  ): Promise<FxRateEntity> {
    const rate = await this.fxRateRepo.findOne({
      where: { baseCurrency, quoteCurrency },
      order: { timestamp: 'DESC' },
    });
    if (!rate)
      throw new NotFoundException(
        `FX rate not found: ${baseCurrency}/${quoteCurrency}`,
      );
    return rate;
  }

  async getRateAsOf(
    baseCurrency: string,
    quoteCurrency: string,
    asOfTimestamp: Date,
  ): Promise<FxRateEntity> {
    const rate = await this.fxRateRepo
      .createQueryBuilder('fx')
      .where('fx.base_currency = :base', { base: baseCurrency })
      .andWhere('fx.quote_currency = :quote', { quote: quoteCurrency })
      .andWhere('fx.timestamp <= :asOf', { asOf: asOfTimestamp })
      .orderBy('fx.timestamp', 'DESC')
      .getOne();
    if (!rate)
      throw new NotFoundException(
        `FX rate not found: ${baseCurrency}/${quoteCurrency} as of ${asOfTimestamp.toISOString()}`,
      );
    return rate;
  }

  async getAllRates(): Promise<FxRateEntity[]> {
    // Get latest rate for each pair
    const rates = await this.fxRateRepo
      .createQueryBuilder('fx')
      .distinctOn(['fx.base_currency', 'fx.quote_currency'])
      .orderBy('fx.base_currency')
      .addOrderBy('fx.quote_currency')
      .addOrderBy('fx.timestamp', 'DESC')
      .getMany();
    return rates;
  }

  /**
   * Convert an amount between currencies using the latest rate.
   * Returns the converted amount in minor units of the target currency.
   */
  async convert(
    amountMinorUnits: number,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<{ amountMinorUnits: number; rate: number; rateTimestamp: Date }> {
    if (fromCurrency === toCurrency) {
      return { amountMinorUnits, rate: 1, rateTimestamp: new Date() };
    }

    const fxRate = await this.getLatestRate(fromCurrency, toCurrency);

    // Import currency configs for precision
    const { CURRENCY_CONFIGS } = await import(
      '../../common/types/currency'
    );
    const fromConfig = CURRENCY_CONFIGS[fromCurrency as keyof typeof CURRENCY_CONFIGS];
    const toConfig = CURRENCY_CONFIGS[toCurrency as keyof typeof CURRENCY_CONFIGS];

    if (!fromConfig || !toConfig) {
      throw new Error(`Unsupported currency: ${fromCurrency} or ${toCurrency}`);
    }

    // `rate` is a `decimal(12,6)` column → TypeORM hydrates it as a string on Postgres.
    // Coerce once for the returned `rate: number` contract (a raw string would leak out).
    const rate = Number(fxRate.rate);

    // Money conversion via EXACT integer (BigInt) arithmetic. Float64 mis-rounds
    // ~1/8000 of the POS domain by one minor unit at large amounts (e.g. a high-value
    // JPY→USD conversion), so we never go through Number multiplication here.
    //   minorTo = round( amount × micros × 10^toPrec / 10^(fromPrec + 6) )
    // micros = rate × 10^6 is an exact integer (column scale is 6); Math.round absorbs
    // the sub-0.5 float error of Number()×1e6 before it ever reaches the BigInt math.
    const micros = BigInt(Math.round(rate * 1e6));
    const num = BigInt(amountMinorUnits) * micros * 10n ** BigInt(toConfig.precision);
    const den = 10n ** BigInt(fromConfig.precision + 6);
    // round-half-up; handle sign defensively though amounts are non-negative.
    const neg = num < 0n;
    const mag = neg ? -num : num;
    const rounded = (mag + den / 2n) / den;
    const minorTo = Number(neg ? -rounded : rounded);

    return {
      amountMinorUnits: minorTo,
      rate,
      rateTimestamp: fxRate.timestamp,
    };
  }
}
