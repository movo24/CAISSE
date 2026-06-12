import Anthropic from '@anthropic-ai/sdk';
import { BriefFindings } from './brief-findings.service';
import { BriefNarrator, TemplateBriefNarrator } from './brief-narrator.interface';

/**
 * Étage 3 — the ratified LLM provider behind the BRIEF_NARRATOR seam (GO'd):
 * Claude Haiku 4.5 (`claude-haiku-4-5`). The task is RENDERING, not reasoning —
 * the findings engine already computed everything; the model only puts prose on
 * the findings, and the provenance guard validates its output (untrusted by
 * design). So we optimize cost/latency, not capability.
 *
 * The pieces that make the no-retry corollary REAL (not hoped):
 *  - BOUNDED TIMEOUT (default 15s, SDK-enforced): a hanging call cannot stall the
 *    generation — it throws, the beat fails cleanly, the template floor is served.
 *  - maxRetries: 0 — no transparent SDK retries; a failed beat holds the template
 *    until the next beat (ratified corollary), never a retry storm.
 *  - LOW max_tokens (default 600): briefs are short.
 *
 * The API key comes from the environment (ANTHROPIC_API_KEY) — never hardcoded.
 * No key → the factory returns the deterministic template narrator: the cockpit
 * is fully functional without any provider (the floor).
 */
export interface HaikuNarratorOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  /** Test seam: inject a fetch implementation (no network in tests). */
  fetch?: typeof globalThis.fetch;
}

const SYSTEM_PROMPT = [
  'Tu rédiges le brief quotidien d’un réseau de magasins à partir d’un objet JSON de "findings" déterministes.',
  'Écris un brief bref (5 à 10 lignes), en français, factuel et clair, pour un dirigeant pressé.',
  'Règles STRICTES :',
  '- Utilise UNIQUEMENT des nombres présents dans les findings. N’invente, n’extrapole et ne recalcule RIEN.',
  '- Les champs en *Minor sont des centimes : affiche-les en euros en divisant par 100 (ex. 150000 → 1500,00 €), sans autre arrondi.',
  '- Les pourcentages : seuls ceux déjà présents dans les findings (deltas, pct), tels quels.',
  '- Cite les noms de magasins VERBATIM, sans les abréger ni les reformuler.',
  '- Si une donnée est null ou absente, ne la mentionne pas.',
].join('\n');

export class HaikuBriefNarrator implements BriefNarrator {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: HaikuNarratorOptions) {
    this.model = opts.model ?? 'claude-haiku-4-5';
    this.maxTokens = opts.maxTokens ?? 600;
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      timeout: opts.timeoutMs ?? 15_000, // bounded: a hanging call fails the beat cleanly
      maxRetries: 0, // the corollary: hold the template until the next beat, never retry
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  async render(findings: BriefFindings): Promise<string> {
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(findings) }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) throw new Error('empty narration');
    return text;
  }
}

/**
 * The provider decision in one place: key present → Haiku behind the seam; no key
 * → the deterministic template (the floor — fully functional, provider-free).
 */
export function makeBriefNarrator(apiKey?: string | null): BriefNarrator {
  return apiKey ? new HaikuBriefNarrator({ apiKey }) : new TemplateBriefNarrator();
}
