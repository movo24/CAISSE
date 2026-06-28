/**
 * POS — Employee PIN policy (pure, unit-testable).
 * Extracted from EmployeesService.validatePinFormat (behavior-preserving):
 * a PIN is 4–8 digits, usable on the POS keypad.
 *
 * `isWeakPin` is provided for future hardening but is NOT wired into the
 * current validation path (enabling it would change accepted-PIN behavior).
 */

/** True when `pin` is a syntactically valid POS PIN (4–8 digits). */
export function isValidPinFormat(pin: unknown): boolean {
  return typeof pin === 'string' && /^\d{4,8}$/.test(pin);
}

/**
 * Heuristic weakness check (advisory only — not enforced).
 * Flags all-same-digit (0000, 1111…) and strictly ascending/descending runs
 * (1234, 4321…). Assumes the PIN already passed isValidPinFormat.
 */
export function isWeakPin(pin: string): boolean {
  if (!isValidPinFormat(pin)) return false;
  if (/^(\d)\1+$/.test(pin)) return true; // all identical digits
  const digits = pin.split('').map((d) => parseInt(d, 10));
  const asc = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const desc = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return asc || desc;
}
