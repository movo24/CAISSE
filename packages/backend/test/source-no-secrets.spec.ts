/**
 * POS-INT-237 — guard-rail: no hardcoded real secret in source code.
 * Scans backend + front src for secret patterns. Excludes spec/test files
 * (they carry fake secrets on purpose) and secret-scan.ts (defines the patterns).
 */
import * as fs from 'fs';
import * as path from 'path';
import { findSecretLeaks, SecretHit } from '../src/common/config/secret-scan';

const ROOT = path.join(__dirname, '../../..');
const SRC_DIRS = [
  'packages/backend/src',
  'packages/backoffice-web/src',
  'packages/pos-desktop/src',
].map((d) => path.join(ROOT, d));

const EXCLUDE = /\.(spec|test)\.tsx?$/;
const EXCLUDE_FILES = new Set(['secret-scan.ts']);

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(e.name) && !EXCLUDE.test(e.name) && !EXCLUDE_FILES.has(e.name)) out.push(p);
  }
  return out;
}

describe('source code secret-leak guard (POS-INT-237)', () => {
  it('no source file hardcodes a real secret', () => {
    const offenders: { file: string; hits: SecretHit[] }[] = [];
    for (const dir of SRC_DIRS) {
      for (const f of walk(dir)) {
        const hits = findSecretLeaks(fs.readFileSync(f, 'utf8'));
        if (hits.length) offenders.push({ file: path.relative(ROOT, f), hits });
      }
    }
    expect(offenders).toEqual([]);
  });
});
