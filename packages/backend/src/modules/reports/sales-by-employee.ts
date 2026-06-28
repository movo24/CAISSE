/**
 * POS-094 — Sales aggregated per employee (pure, unit-testable).
 * Foundation for "ventes par employé" reporting and sensitive-action control.
 * Consumes already-frozen completed sales; computes per-employee count / revenue / discount,
 * sorted by revenue desc. Not yet exposed via an endpoint (reporting wiring = follow-up).
 */

export interface EmpSaleInput {
  employeeId: string;
  employeeNameSnapshot?: string | null;
  totalMinorUnits: number;
  discountTotalMinorUnits: number;
}

export interface EmployeeSalesRow {
  employeeId: string;
  employeeName: string;
  transactionCount: number;
  revenueMinorUnits: number;
  discountMinorUnits: number;
  averageBasketMinorUnits: number;
}

export function aggregateSalesByEmployee(sales: EmpSaleInput[]): EmployeeSalesRow[] {
  const map = new Map<string, EmployeeSalesRow>();
  for (const s of sales) {
    let row = map.get(s.employeeId);
    if (!row) {
      row = {
        employeeId: s.employeeId,
        employeeName: s.employeeNameSnapshot || '',
        transactionCount: 0,
        revenueMinorUnits: 0,
        discountMinorUnits: 0,
        averageBasketMinorUnits: 0,
      };
      map.set(s.employeeId, row);
    }
    row.transactionCount += 1;
    row.revenueMinorUnits += s.totalMinorUnits;
    row.discountMinorUnits += s.discountTotalMinorUnits;
  }
  const rows = [...map.values()];
  for (const r of rows) {
    r.averageBasketMinorUnits =
      r.transactionCount > 0 ? Math.round(r.revenueMinorUnits / r.transactionCount) : 0;
  }
  return rows.sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits);
}
