/**
 * POS-INT-226 — guard-rail: no real secret in any tracked .env.example.
 * Fails CI if a real-looking credential is committed. Reuses findSecretLeaks.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findSecretLeaks } from '../src/common/config/secret-scan';

const ROOT = path.join(__dirname, '../../..'); // repo root
const CANDIDATES = [
  'packages/backend/.env.example',
  'packages/backoffice-web/.env.example',
  'packages/pos-desktop/.env.example',
];

describe('.env.example secret-leak guard (POS-INT-226)', () => {
  for (const rel of CANDIDATES) {
    const abs = path.join(ROOT, rel);
    it(`${rel} contains no real secret`, () => {
      if (!fs.existsSync(abs)) return; // absent = nothing to leak
      const hits = findSecretLeaks(fs.readFileSync(abs, 'utf8'));
      expect(hits).toEqual([]);
    });
  }
});
