/**
 * P320 (cycle I3) — structural validator for the social chart JSON (GATE 3).
 *
 *   npm run social:check -- chemin/vers/plan.json
 *
 * Checks STRUCTURE only (slots present + non-empty, validatedBy/At, ISO date)
 * by reusing the REAL runtime guard (`canPostSocialEntries`) — so what this
 * script accepts is exactly what the backend will accept. It cannot and does
 * not validate the accounting correctness of the codes (accountant's job).
 */
import { readFileSync } from 'fs';
import {
  canPostSocialEntries,
  REQUIRED_SOCIAL_ACCOUNT_SLOTS,
  ValidatedSocialChart,
} from '../modules/comptamax/social-entries-guard';

export interface SocialChartCheck {
  ok: boolean;
  errors: string[];
}

/** Pure check — exported for tests. */
export function checkSocialChart(raw: unknown): SocialChartCheck {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['Le fichier doit contenir un objet JSON.'] };
  }
  const chart = raw as ValidatedSocialChart & { validatedAt?: string };

  // Reuse the REAL guard with the flag forced on → structural verdict identical to runtime.
  const guard = canPostSocialEntries('true', chart);
  if (!guard.allowed) {
    errors.push(guard.reason ?? 'Refusé par le garde.');
    if (guard.missingSlots?.length) errors.push(`Slots manquants/vides : ${guard.missingSlots.join(', ')}`);
  }
  if (chart.validatedAt && !/^\d{4}-\d{2}-\d{2}/.test(String(chart.validatedAt))) {
    errors.push(`validatedAt doit être une date ISO (YYYY-MM-DD), reçu : "${chart.validatedAt}"`);
  }
  const unknownKeys = Object.keys((chart as any).accounts ?? {}).filter(
    (k) => !(REQUIRED_SOCIAL_ACCOUNT_SLOTS as readonly string[]).includes(k),
  );
  if (unknownKeys.length) errors.push(`Slots inconnus (typo ?) : ${unknownKeys.join(', ')}`);

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start — CLI wrapper */
if (require.main === module) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: npm run social:check -- <plan.json>');
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e: any) {
    console.error(`JSON illisible: ${e?.message}`);
    process.exit(1);
  }
  const res = checkSocialChart(parsed);
  if (res.ok) {
    console.log('✅ Structure valide — transmissible au backend (la justesse comptable reste à la charge du comptable).');
  } else {
    console.error('❌ Structure invalide :');
    for (const e of res.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}
/* c8 ignore stop */
