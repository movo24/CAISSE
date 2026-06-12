/**
 * Étage 3 — Haiku narrator behind the seam (ratified provider). No network: the
 * fetch implementation is injected. DECISIVE pieces (they make the no-retry
 * corollary real): a HANGING call is killed by the bounded timeout (the beat
 * fails cleanly → template floor), and a failed call is NOT retried (exactly one
 * request). Plus: correct model/params on the wire, and the env-driven factory
 * (no key → template floor).
 */
import { HaikuBriefNarrator, makeBriefNarrator } from '../src/modules/ai-brief/haiku-brief.narrator';
import { TemplateBriefNarrator } from '../src/modules/ai-brief/brief-narrator.interface';
import { BriefFindings } from '../src/modules/ai-brief/brief-findings.service';

const FINDINGS: BriefFindings = {
  businessDay: '2026-06-12',
  scope: { storeCount: 1 },
  totals: {
    caBrutMinor: 150000, netMinor: 150000, txCount: 42, voidCount: 0, returnsAmountMinor: 0,
    discountTotalMinor: 0, targetMinor: null, targetReachedPct: null, presentCount: 0,
    expectedCount: 0, openSessions: 0, activeTerminals: 0, ruptureCount: 0, lowStockCount: 0, alertCount: 0,
  },
  stores: [],
  alerts: [],
  computedAt: '2026-06-12T09:00:00.000Z',
};

const anthropicResponse = (text: string) =>
  new Response(
    JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-4-5',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('Étage 3 — HaikuBriefNarrator (provider behind the seam)', () => {
  it('happy path — calls claude-haiku-4-5 with low max_tokens + system prompt, returns the prose', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchMock = (async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return anthropicResponse('Belle journée : 42 tickets pour 1500,00 €.');
    }) as typeof fetch;

    const narrator = new HaikuBriefNarrator({ apiKey: 'sk-test', fetch: fetchMock });
    const text = await narrator.render(FINDINGS);

    expect(text).toBe('Belle journée : 42 tickets pour 1500,00 €.');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/v1/messages');
    expect(calls[0].body.model).toBe('claude-haiku-4-5');
    expect(calls[0].body.max_tokens).toBe(600); // briefs are short
    expect(calls[0].body.system).toContain('UNIQUEMENT des nombres présents');
    expect(calls[0].body.messages[0].content).toContain('"caBrutMinor":150000'); // findings only
  });

  it('DECISIVE — a HANGING call is killed by the bounded timeout (the beat fails cleanly)', async () => {
    const hangingFetch = ((_url: any, init: any) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      })) as typeof fetch;

    const narrator = new HaikuBriefNarrator({ apiKey: 'sk-test', fetch: hangingFetch, timeoutMs: 60 });
    await expect(narrator.render(FINDINGS)).rejects.toThrow(); // throws → AiBriefService serves the template floor
  });

  it('DECISIVE — a failed call is NOT retried (maxRetries 0: exactly one request, then the floor)', async () => {
    let calls = 0;
    const failingFetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }), {
        status: 500, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const narrator = new HaikuBriefNarrator({ apiKey: 'sk-test', fetch: failingFetch });
    await expect(narrator.render(FINDINGS)).rejects.toThrow();
    expect(calls).toBe(1); // no transparent retry — hold the template until the next beat
  });

  it('empty narration → throws (never serve an empty brief as success)', async () => {
    const emptyFetch = (async () => anthropicResponse('')) as typeof fetch;
    const narrator = new HaikuBriefNarrator({ apiKey: 'sk-test', fetch: emptyFetch });
    await expect(narrator.render(FINDINGS)).rejects.toThrow(/empty/);
  });

  it('factory — no API key → the deterministic template floor; key → Haiku behind the seam', () => {
    expect(makeBriefNarrator(undefined)).toBeInstanceOf(TemplateBriefNarrator);
    expect(makeBriefNarrator(null)).toBeInstanceOf(TemplateBriefNarrator);
    expect(makeBriefNarrator('sk-test')).toBeInstanceOf(HaikuBriefNarrator);
  });
});
