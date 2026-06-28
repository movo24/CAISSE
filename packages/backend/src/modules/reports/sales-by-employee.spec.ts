import { aggregateSalesByEmployee, EmpSaleInput } from './sales-by-employee';

describe('POS-094 aggregateSalesByEmployee', () => {
  const sales: EmpSaleInput[] = [
    { employeeId: 'e1', employeeNameSnapshot: 'Alice', totalMinorUnits: 1000, discountTotalMinorUnits: 100 },
    { employeeId: 'e1', employeeNameSnapshot: 'Alice', totalMinorUnits: 2000, discountTotalMinorUnits: 0 },
    { employeeId: 'e2', employeeNameSnapshot: 'Bob', totalMinorUnits: 500, discountTotalMinorUnits: 50 },
  ];

  it('aggregates count/revenue/discount per employee', () => {
    const rows = aggregateSalesByEmployee(sales);
    const alice = rows.find((r) => r.employeeId === 'e1')!;
    expect(alice.transactionCount).toBe(2);
    expect(alice.revenueMinorUnits).toBe(3000);
    expect(alice.discountMinorUnits).toBe(100);
    expect(alice.averageBasketMinorUnits).toBe(1500);
  });

  it('sorts by revenue desc', () => {
    const rows = aggregateSalesByEmployee(sales);
    expect(rows[0].employeeId).toBe('e1');
    expect(rows[1].employeeId).toBe('e2');
  });

  it('empty list = empty', () => {
    expect(aggregateSalesByEmployee([])).toEqual([]);
  });

  it('missing name falls back to empty string', () => {
    const rows = aggregateSalesByEmployee([
      { employeeId: 'e9', totalMinorUnits: 100, discountTotalMinorUnits: 0 },
    ]);
    expect(rows[0].employeeName).toBe('');
  });
});
