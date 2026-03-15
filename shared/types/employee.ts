export type EmployeeRole = 'admin' | 'manager' | 'cashier';

export interface Employee {
  id: string;
  storeId: string;
  firstName: string;
  lastName: string;
  email: string;
  pin: string;               // hashed
  qrCode: string;            // unique QR identifier
  role: EmployeeRole;
  maxDiscountPercent: number; // max manual discount allowed
  isActive: boolean;
  createdAt: string;
}
