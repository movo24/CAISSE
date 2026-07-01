/**
 * POS-INT-231 — guard-rail: no real secret in tracked Markdown docs
 * (README, runbooks, resume/gate checklists). Placeholders tolerated.
 * Reuses findSecretLeaks (tested in secret-scan.spec).
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { findSecretLeaks, SecretHit } from '../src/common/config/secret-scan';

const ROOT = path.join(__dirname, '../../..');

/** Tracked *.md files (git); fallback to repo-root + backend *.md if git absent. */
function trackedMarkdown(): string[] {
  try {
    const out = execSync('git ls-files "*.md"', { cwd: ROOT, encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean).map((f) => path.join(ROOT, f));
  } catch {
    const roots = [ROOT, path.join(ROOT, 'packages/backend')];
    return roots.flatMap((d) =>
      fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => path.join(d, f)) : [],
    );
  }
}

describe('tracked Markdown secret-leak guard (POS-INT-231)', () => {
  it('no tracked .md contains a real secret', () => {
    const offenders: { file: string; hits: SecretHit[] }[] = [];
    for (const f of trackedMarkdown()) {
      if (!fs.existsSync(f) || f.includes('node_modules')) continue;
      const hits = findSecretLeaks(fs.readFileSync(f, 'utf8'));
      if (hits.length) offenders.push({ file: path.relative(ROOT, f), hits });
    }
    expect(offenders).toEqual([]);
  });
});
