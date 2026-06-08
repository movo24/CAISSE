import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { EvaluateSaleGuardsDto } from './evaluate-sale-guards.dto';

/**
 * Contract test reproducing the EXACT global ValidationPipe behaviour from
 * main.ts ({ whitelist: true, forbidNonWhitelisted: true, transform: true }).
 *
 * This locks the request contract so the "missing `ean` → 400 → fail-open →
 * guards silently inert" regression can never recur unnoticed.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const meta = { type: 'body' as const, metatype: EvaluateSaleGuardsDto };

const transform = (payload: unknown) => pipe.transform(payload, meta as any);

describe('EvaluateSaleGuardsDto — request contract', () => {
  it('accepts the exact payload the POS sends (incl. ean)', async () => {
    const payload = {
      items: [
        {
          productId: 'p1',
          ean: '3760168390157',
          quantity: 2,
          sellPriceMinorUnits: 180,
          discountMinorUnits: 0,
        },
      ],
    };
    const out = await transform(payload);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].ean).toBe('3760168390157');
  });

  it('accepts a minimal item (productId + quantity only)', async () => {
    const out = await transform({ items: [{ productId: 'p1', quantity: 1 }] });
    expect(out.items[0].productId).toBe('p1');
  });

  it('rejects an unknown field on an item (forbidNonWhitelisted)', async () => {
    await expect(
      transform({ items: [{ productId: 'p1', quantity: 1, hackerField: 'x' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown field at the top level', async () => {
    await expect(
      transform({ items: [{ productId: 'p1', quantity: 1 }], evil: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-integer quantity', async () => {
    await expect(
      transform({ items: [{ productId: 'p1', quantity: 'two' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts optional manager/abuse counters', async () => {
    const out = await transform({
      items: [{ productId: 'p1', quantity: 1 }],
      freeProductUsageCount: 12,
      cancellationCount: 6,
    });
    expect(out.freeProductUsageCount).toBe(12);
  });
});
