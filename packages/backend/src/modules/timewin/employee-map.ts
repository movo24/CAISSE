/**
 * TimeWin24 → CAISSE employee cache mapping (pure, unit-testable).
 * Extracted from TimewinService.syncEmployees (behavior-preserving).
 * TimeWin24 is the HR source of truth; the POS caches a read-only projection for offline use.
 * `posPinHash` is intentionally empty here (PIN no longer returned by TimeWin24; set elsewhere).
 */
export interface MappedEmployee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
  posPinHash: string;
  posRole: string;
  maxDiscountPct: number;
  skills: string[];
  cachedAt: number;
}

export function mapTimewinEmployee(e: any, cachedAt: number): MappedEmployee {
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    active: e.active,
    posPinHash: '',
    posRole: e.posRole,
    maxDiscountPct: e.maxDiscountPct,
    skills: e.skills || [],
    cachedAt,
  };
}
