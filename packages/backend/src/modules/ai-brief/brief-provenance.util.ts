/**
 * Étage 3 — PROVENANCE GUARD (INV-3 made structural, part 2). Pure function: every
 * number in a rendered brief must trace back to a findings value (modulo format
 * variants). One untraceable number → the brief is INVALID and must never be
 * served. This is the analogue of the computed_at hard guard / the 23505 dedup:
 * the violation is caught at the write point, not hoped absent. The narrator
 * (LLM or template) is untrusted BY DESIGN — its output is validated, not believed.
 */
import { BriefFindings } from './brief-findings.service';

export interface ProvenanceResult {
  valid: boolean;
  /** The text tokens that could not be traced to any findings value. */
  untraceable: string[];
}

/** Canonical key for value comparison: rounded to 2 decimals. */
const key = (v: number): string => (Math.round(v * 100) / 100).toFixed(2);

/**
 * The allowed set: every numeric leaf of the findings, plus format variants —
 * the value itself, its absolute value (prose may drop the sign: "en baisse de
 * 12,3%"), and its minor→major currency reading (v/100, how amounts are displayed).
 * Plus the businessDay date components (year/month/day appear in any dated prose).
 */
export function collectAllowedValues(findings: BriefFindings): Set<string> {
  const allowed = new Set<string>();
  const add = (v: number) => {
    if (!Number.isFinite(v)) return;
    allowed.add(key(v));
    allowed.add(key(Math.abs(v)));
    allowed.add(key(v / 100)); // minor units → major (euros)
    allowed.add(key(Math.abs(v) / 100));
  };
  const walk = (node: unknown): void => {
    if (typeof node === 'number') add(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
    else if (typeof node === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(node)) {
      // Date components only (dated prose like "le 12"). NOTE — implementation (A):
      // digits embedded in other sourced strings (store names like "B43") do NOT
      // join the allowed set; those strings are consumed WHOLE by the scrub in
      // verifyBriefProvenance, so a fabricated metric can never launder a name's
      // digits ("43 %" out of "B43").
      node.split('-').map(Number).forEach((v) => allowed.add(key(v)));
    }
  };
  walk(findings);
  return allowed;
}

/**
 * Sourced strings that may legitimately appear in prose (store names, codes…):
 * every digit-bearing string leaf of the findings. The verifier removes their
 * VERBATIM occurrences from the text before numeric validation — longest first so
 * a contained substring is scrubbed by its container. Conservative corollary: a
 * SHORTENED quote ("B43" for "Grand Littoral B43") does not scrub and fails
 * CLOSED → fallback, never a leak.
 */
export function collectSourcedStrings(findings: BriefFindings): string[] {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
    else if (typeof node === 'string' && /\d/.test(node)) out.add(node);
  };
  walk(findings);
  return [...out].sort((a, b) => b.length - a.length);
}

/** Extract number tokens from prose: "1 234,56", "1,234.56", "12.5", "70", "120000". */
const NUMBER_TOKEN = /\d+(?:[   ,]\d{3})*(?:[.,]\d+)?/g;

/** All plausible numeric readings of a token (FR/EN separator ambiguity). */
function candidateParses(raw: string): number[] {
  const noSpaces = raw.replace(/[   ]/g, '');
  const out = new Set<number>();
  const push = (s: string) => {
    const n = Number(s);
    if (Number.isFinite(n)) out.add(n);
  };
  if (noSpaces.includes('.') && noSpaces.includes(',')) {
    // the LAST separator is the decimal mark
    if (noSpaces.lastIndexOf(',') > noSpaces.lastIndexOf('.')) push(noSpaces.replace(/\./g, '').replace(',', '.'));
    else push(noSpaces.replace(/,/g, ''));
  } else if (noSpaces.includes(',')) {
    push(noSpaces.replace(',', '.')); // comma as decimal (FR)
    push(noSpaces.replace(/,/g, '')); // comma as thousands (EN)
  } else {
    push(noSpaces);
  }
  return [...out];
}

export function verifyBriefProvenance(findings: BriefFindings, text: string): ProvenanceResult {
  const allowed = collectAllowedValues(findings);

  // Implementation (A): consume sourced strings WHOLE before numeric validation.
  let scrubbed = text;
  for (const s of collectSourcedStrings(findings)) {
    scrubbed = scrubbed.split(s).join(' ');
  }

  const untraceable: string[] = [];
  for (const token of scrubbed.match(NUMBER_TOKEN) ?? []) {
    const traced = candidateParses(token).some((n) => allowed.has(key(n)));
    if (!traced) untraceable.push(token);
  }
  return { valid: untraceable.length === 0, untraceable };
}
