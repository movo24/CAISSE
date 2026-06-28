import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateSaleDto } from './sales.dto';

/**
 * POS-040/043 — validation of the sale DTO, focused on the store_credit regression:
 * an avoir payment (method 'store_credit' + creditNoteCode) must be accepted, and an
 * unknown method must be rejected (global ValidationPipe uses these decorators).
 */
function errorsFor(payload: any) {
  return validateSync(plainToInstance(CreateSaleDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('POS-040/043 CreateSaleDto validation', () => {
  const base = {
    items: [{ ean: '111', quantity: 1 }],
  };

  it('accepts a store_credit payment with creditNoteCode (avoir)', () => {
    const errors = errorsFor({
      ...base,
      payments: [{ method: 'store_credit', amountMinorUnits: 500, creditNoteCode: 'AV-1' }],
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts cash + card mixed payments', () => {
    const errors = errorsFor({
      ...base,
      payments: [
        { method: 'cash', amountMinorUnits: 300 },
        { method: 'card', amountMinorUnits: 200 },
      ],
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown payment method', () => {
    const errors = errorsFor({
      ...base,
      payments: [{ method: 'bitcoin', amountMinorUnits: 500 }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a sale with no items', () => {
    const errors = errorsFor({
      items: [],
      payments: [{ method: 'cash', amountMinorUnits: 100 }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
