import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SalePaymentDto } from './sales.dto';

/**
 * M005 — the `store_credit` tender must be reachable over HTTP. Before the fix the
 * DTO `@IsIn` whitelist rejected it (and dropped `creditNoteCode`), so the avoir
 * redemption path the service supports was unreachable from the API.
 */
describe('SalePaymentDto — tender whitelist (M005)', () => {
  const validateDto = (obj: any) => validate(plainToInstance(SalePaymentDto, obj));

  it('accepts a store_credit leg carrying a creditNoteCode', async () => {
    const errors = await validateDto({ method: 'store_credit', amountMinorUnits: 500, creditNoteCode: 'AV-ABC123' });
    expect(errors).toHaveLength(0);
  });

  it('still accepts the standard tenders', async () => {
    for (const method of ['cash', 'card', 'mobile', 'check', 'voucher']) {
      expect(await validateDto({ method, amountMinorUnits: 100 })).toHaveLength(0);
    }
  });

  it('rejects an unknown tender', async () => {
    const errors = await validateDto({ method: 'bitcoin', amountMinorUnits: 100 });
    expect(errors.length).toBeGreaterThan(0);
  });
});
