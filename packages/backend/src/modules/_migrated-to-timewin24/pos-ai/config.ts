// ── pos-ai/config.ts ────────────────────────────────────────────
// Configuration & feature flags for POS AI module
// ─────────────────────────────────────────────────────────────────

export const POS_AI_CONFIG = {
  // ── Feature flag ──
  get enabled(): boolean {
    return process.env.POS_AI_ENABLED !== 'false';
  },

  // ── Gemini ──
  get geminiApiKey(): string {
    return process.env.GEMINI_API_KEY || '';
  },
  get geminiAvailable(): boolean {
    return POS_AI_CONFIG.enabled && POS_AI_CONFIG.geminiApiKey.length > 0;
  },
  geminiModel: 'gemini-2.5-flash',
  geminiEmbeddingModel: 'gemini-embedding-001',
  embeddingDimensions: 3072,

  // ── Timeouts & Retries ──
  requestTimeoutMs: 10_000,
  maxRetries: 2,
  retryDelayMs: 1_000,

  // ── Vector search ──
  defaultSearchLimit: 10,
  similarityThreshold: 0.3, // minimum cosine similarity to include in results

  // ── Sync ──
  batchSize: 50, // embeddings per batch call

  // ── Rate limiting ──
  maxRequestsPerMinute: 30,

  // ── Cache ──
  embeddingCacheTtlMs: 3600_000, // 1 hour
};
