import { EmployeeRole } from './employee';

export interface AuthPayload {
  employeeId: string;
  storeId: string;
  role: EmployeeRole;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  storeId: string;
  pin?: string;
  qrCode?: string;
}
