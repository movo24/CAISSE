import { BriefFindings } from './brief-findings.service';

/**
 * Étage 3 — the narration seam (INV-3, part 3). A narrator receives FINDINGS and
 * emits PROSE — it never receives raw data to compute from, and its output is
 * validated by the provenance guard before being served (untrusted by design).
 *
 * The concrete LLM provider (model, endpoint, cost posture) is an OWNER decision —
 * surfaced, not hardcoded. Any provider implements this interface and is wired on
 * the BRIEF_NARRATOR token; the default is the deterministic template narrator
 * (provider-free), which is also the fallback when a rendered brief is rejected.
 */
export const BRIEF_NARRATOR = 'BRIEF_NARRATOR';

export interface BriefNarrator {
  render(findings: BriefFindings): Promise<string>;
}

/** Format centimes as a European-style amount string ("1234,56"). */
const euros = (minor: number): string => (minor / 100).toFixed(2).replace('.', ',');

/**
 * Deterministic, provider-free narration — every number comes verbatim from the
 * findings (provenance-clean by construction). Default narrator and the rejection
 * fallback.
 */
export function renderTemplateBrief(f: BriefFindings): string {
  const t = f.totals;
  const lines: string[] = [];
  lines.push(`Brief du ${f.businessDay} — ${f.scope.storeCount} magasin(s).`);
  lines.push(
    `CA brut ${euros(t.caBrutMinor)} € (net ${euros(t.netMinor)} €) pour ${t.txCount} tickets, ` +
      `${t.voidCount} annulation(s), remises ${euros(t.discountTotalMinor)} €, retours ${euros(t.returnsAmountMinor)} €.`,
  );
  if (t.targetMinor !== null && t.targetReachedPct !== null) {
    lines.push(`Objectif ${euros(t.targetMinor)} € — atteint à ${String(t.targetReachedPct).replace('.', ',')}%.`);
  }
  lines.push(
    `Présence ${t.presentCount}/${t.expectedCount}, ${t.openSessions} session(s) ouverte(s) sur ${t.activeTerminals} terminal(aux), ` +
      `${t.ruptureCount} rupture(s), ${t.lowStockCount} stock(s) bas.`,
  );
  for (const s of f.stores) {
    const delta =
      s.deltaVsPrevDayPct !== null ? ` (${String(s.deltaVsPrevDayPct).replace('.', ',')}% vs veille)` : '';
    lines.push(`${s.name ?? s.storeId} : CA ${euros(s.caBrutMinor)} €, ${s.txCount} tickets${delta}.`);
  }
  lines.push(
    t.alertCount > 0
      ? `${t.alertCount} alerte(s) : ${f.alerts.map((a) => `${a.rule}/${a.thresholdBand}`).join(', ')}.`
      : `Aucune alerte.`,
  );
  return lines.join('\n');
}

export class TemplateBriefNarrator implements BriefNarrator {
  async render(findings: BriefFindings): Promise<string> {
    return renderTemplateBrief(findings);
  }
}
