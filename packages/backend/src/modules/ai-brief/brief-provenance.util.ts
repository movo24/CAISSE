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
    else if (typeof node === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(node)) {
        node.split('-').map(Number).forEach((v) => allowed.add(key(v)));
      } else {
        // Numbers embedded in SOURCED strings (store names like "B43", "Grand
        // Littoral B43") are findings content — prose quoting the name must trace.
        for (const token of node.match(NUMBER_TOKEN) ?? []) {
          candidateParses(token).forEach((n) => allowed.add(key(n)));
        }
      }
    }
  };
  walk(findings);
  return allowed;
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
  const untraceable: string[] = [];
  for (const token of text.match(NUMBER_TOKEN) ?? []) {
    const traced = candidateParses(token).some((n) => allowed.has(key(n)));
    if (!traced) untraceable.push(token);
  }
  return { valid: untraceable.length === 0, untraceable };
}
