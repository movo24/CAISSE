/**
 * POS-INT-217 — guard-rail: every process.env.X read in backend src MUST be
 * documented in .env.example. Fails CI if a new env var is introduced without
 * documentation (prevents "missing var at boot" surprises on resume/deploy).
 * Reuses the pure missingEnvVars() classifier (tested in preflight-checks.spec).
 */
import * as fs from 'fs';
import * as path from 'path';
import { missingEnvVars } from '../src/common/config/preflight-checks';

const SRC = path.join(__dirname, '../src');
const ENV_EXAMPLE = path.join(__dirname, '../.env.example');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

function usedEnvVars(): string[] {
  const re = /process\.env\.([A-Z0-9_]+)/g;
  const set = new Set<string>();
  for (const file of walk(SRC)) {
    const txt = fs.readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt))) set.add(m[1]);
  }
  return [...set];
}

function documentedEnvVars(): string[] {
  const txt = fs.readFileSync(ENV_EXAMPLE, 'utf8');
  return txt
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=/)?.[1])
    .filter((x): x is string => !!x);
}

describe('.env.example completeness (POS-INT-217)', () => {
  it('documents every env var read in backend src', () => {
    const missing = missingEnvVars(usedEnvVars(), documentedEnvVars());
    expect(missing).toEqual([]);
  });
});
