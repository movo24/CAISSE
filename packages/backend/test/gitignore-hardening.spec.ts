/**
 * POS-INT-233 — guard-rail: sensitive artifacts are ignored AND none are tracked.
 * (a) .gitignore contains the required secret/artifact patterns.
 * (b) git ls-files contains no real .env / key / cert / dump / backup.
 * pos-recovery.bundle is intentionally tracked → NOT flagged.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const ROOT = path.join(__dirname, '../../..');

describe('gitignore/dockerignore hardening (POS-INT-233)', () => {
  it('.gitignore declares required sensitive patterns', () => {
    const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    for (const pat of ['.env.*', '*.pem', '*.key', '*.crt', '*.p12', 'id_rsa', '*.dump', '*.log']) {
      expect(gi).toContain(pat);
    }
    expect(gi).toContain('!.env.example'); // examples stay tracked
  });

  it('.gitignore keeps the recovery bundle trackable (no bare *.bundle ignore)', () => {
    const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    const bareBundle = gi.split(/\r?\n/).some((l) => l.trim() === '*.bundle');
    expect(bareBundle).toBe(false);
  });

  it('no sensitive real file is tracked by git', () => {
    let tracked: string[] = [];
    try {
      tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    } catch {
      return; // no git context → skip
    }
    const offenders = tracked.filter((f) =>
      /(^|\/)\.env$/.test(f) ||
      /\.env\.(production|prod|local)$/.test(f) ||
      /\.(pem|key|crt|cer|p12|pfx|keystore|dump|bak)$/i.test(f) ||
      /(^|\/)id_rsa/.test(f) ||
      /db-backup-/.test(f),
    );
    expect(offenders).toEqual([]);
  });
});
