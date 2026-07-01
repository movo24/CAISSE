/**
 * POS-INT-227 — guard-rail: every `npm run <script>` referenced in ci.yml must
 * exist in the root package.json. Prevents a green-looking config from breaking
 * CI on a renamed/removed script.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../../..');

describe('CI referenced scripts exist (POS-INT-227)', () => {
  it('all `npm run X` in ci.yml are defined in root package.json', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const defined = new Set(Object.keys(pkg.scripts ?? {}));

    const referenced = [...ci.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0); // sanity: we did parse steps

    const missing = [...new Set(referenced)].filter((s) => !defined.has(s));
    expect(missing).toEqual([]);
  });
});
