import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateReturnRequestDto } from './create-return-request.dto';

/**
 * Le motif de remboursement est OBLIGATOIRE au périmètre HTTP (ValidationPipe
 * global). Ce test verrouille la règle : un POST /returns sans motif est rejeté.
 */
function errorsFor(payload: any) {
  const dto = plainToInstance(CreateReturnRequestDto, payload);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
}

const base = {
  originalSaleId: 'sale-1',
  items: [{ lineItemId: 'li1', quantity: 1 }],
  refundMethod: 'store_credit',
};

describe('CreateReturnRequestDto — motif obligatoire', () => {
  it('accepte un remboursement AVEC motif', () => {
    expect(errorsFor({ ...base, reason: 'Article défectueux' })).toHaveLength(0);
  });

  it('rejette un remboursement SANS motif', () => {
    const errs = errorsFor({ ...base });
    expect(errs.some((e) => e.property === 'reason')).toBe(true);
  });

  it('rejette un motif vide ou trop court', () => {
    expect(errorsFor({ ...base, reason: '' }).some((e) => e.property === 'reason')).toBe(true);
    expect(errorsFor({ ...base, reason: 'ab' }).some((e) => e.property === 'reason')).toBe(true);
  });

  it('rejette une requête sans article', () => {
    expect(errorsFor({ ...base, reason: 'x défaut', items: [] }).some((e) => e.property === 'items')).toBe(true);
  });

  it('rejette un mode de remboursement invalide', () => {
    expect(errorsFor({ ...base, reason: 'x défaut', refundMethod: 'bitcoin' }).some((e) => e.property === 'refundMethod')).toBe(true);
  });
});
