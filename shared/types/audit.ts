export type AuditAction =
  | 'sale_completed'
  | 'sale_voided'
  | 'discount_applied'
  | 'drawer_opened'
  | 'cash_in'
  | 'cash_out'
  | 'price_change'
  | 'refund'
  | 'employee_login'
  | 'employee_logout'
  | 'stock_adjustment'
  | 'promo_applied';

export interface AuditEntry {
  id: string;
  storeId: string;
  employeeId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  previousHash: string;
  currentHash: string;
  timestamp: string;
}
