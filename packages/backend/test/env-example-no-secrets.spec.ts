/**
 * POS-INT-226/236 — guard-rail: NO real secret in any tracked env file
 * (.env.example, .env.production.example, docker env examples, etc.).
 * Real `.env` files are gitignored and never scanned here. Reuses findSecretLeaks.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { findSecretLeaks, SecretHit } from '../src/common/config/secret-scan';

const ROOT = path.join(__dirname, '../../..');

/** All tracked files whose basename starts with `.env` (any example variant). */
function trackedEnvFiles(): string[] {
  try {
    return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter((f) => /(^|\/)\.env[.a-zA-Z0-9-]*$/.test(f))
      .map((f) => path.join(ROOT, f));
  } catch {
    return [
      'packages/backend/.env.example',
      'packages/backoffice-web/.env.example',
      'packages/pos-desktop/.env.example',
    ].map((f) => path.join(ROOT, f));
  }
}

describe('tracked env files secret-leak guard (POS-INT-236)', () => {
  it('no tracked .env* file contains a real secret', () => {
    const offenders: { file: string; hits: SecretHit[] }[] = [];
    for (const f of trackedEnvFiles()) {
      if (!fs.existsSync(f)) continue;
      const hits = findSecretLeaks(fs.readFileSync(f, 'utf8'));
      if (hits.length) offenders.push({ file: path.relative(ROOT, f), hits });
    }
    expect(offenders).toEqual([]);
  });

  it('scans at least the known example files (sanity)', () => {
    expect(trackedEnvFiles().length).toBeGreaterThanOrEqual(1);
  });
});
