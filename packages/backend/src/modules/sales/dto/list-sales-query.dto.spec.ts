import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListSalesQueryDto } from './list-sales-query.dto';

const errs = (p: any) =>
  validateSync(plainToInstance(ListSalesQueryDto, p), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('POS-018b ListSalesQueryDto', () => {
  it('accepts valid filters (coerces numeric strings)', () => {
    const dto = plainToInstance(ListSalesQueryDto, { page: '2', limit: '20', status: 'completed' });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.page).toBe(2); // @Type(()=>Number) coercion
    expect(dto.limit).toBe(20);
  });
  it('rejects limit over 100', () => {
    expect(errs({ limit: '500' }).length).toBeGreaterThan(0);
  });
  it('rejects non-uuid employeeId', () => {
    expect(errs({ employeeId: 'not-a-uuid' }).length).toBeGreaterThan(0);
  });
  it('empty query is valid (all optional)', () => {
    expect(errs({}).length).toBe(0);
  });
});
