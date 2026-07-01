/**
 * POS-INT-226 — secret leak scanner (pure, unit-testable).
 * Detects patterns that look like REAL credentials so they never land in a
 * tracked file (.env.example, config). Placeholders are explicitly tolerated.
 * No I/O here — the caller passes file text.
 */

/** Known real-secret shapes. Deliberately conservative to avoid false positives. */
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'stripe-secret', re: /sk_(live|test)_[A-Za-z0-9]{16,}/ },
  { name: 'stripe-webhook', re: /whsec_[A-Za-z0-9]{16,}/ },
  { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'google-api-key', re: /AIza[0-9A-Za-z_\-]{30,}/ },
  { name: 'jwt-like', re: /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/ },
  { name: 'db-url-with-password', re: /postgres(?:ql)?:\/\/[^:@/\s]+:[^@/\s]{8,}@(?!localhost|127\.0\.0\.1|<|\.\.\.)[^/\s]+/ },
];

/** Value tokens that are obviously placeholders (never flagged). */
const PLACEHOLDER_HINTS = /replace|example|placeholder|your|xxxx|\.\.\.|<[^>]+>|change-?me|dummy|fake/i;

export interface SecretHit {
  pattern: string;
  line: number;
  snippet: string;
}

/** Scan text for likely-real secrets. Lines that look like placeholders are skipped. */
export function findSecretLeaks(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = (text ?? '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (PLACEHOLDER_HINTS.test(raw)) return; // tolerate documented placeholders
    for (const { name, re } of SECRET_PATTERNS) {
      const m = re.exec(raw);
      if (m) hits.push({ pattern: name, line: i + 1, snippet: m[0].slice(0, 12) + '…' });
    }
  });
  return hits;
}
