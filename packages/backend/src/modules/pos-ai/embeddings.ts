// ── pos-ai/embeddings.ts ────────────────────────────────────────
// Embedding generation via Gemini text-embedding-004
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { GeminiClientService } from './gemini-client';
import { POS_AI_CONFIG } from './config';
import { EmbeddingResult } from './types';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger('POS-AI:Embeddings');
  private cache = new Map<string, { embedding: number[]; expiresAt: number }>();

  constructor(private readonly gemini: GeminiClientService) {}

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult | null> {
    if (!this.gemini.isAvailable()) {
      this.logger.warn('Gemini not available — cannot generate embedding');
      return null;
    }

    const cleanText = text.trim().toLowerCase();
    if (!cleanText) return null;

    // Check cache
    const cached = this.cache.get(cleanText);
    if (cached && cached.expiresAt > Date.now()) {
      return { text: cleanText, embedding: cached.embedding, dimensions: cached.embedding.length };
    }

    try {
      const client = this.gemini.getClient()!;
      const embModel = client.getGenerativeModel({ model: POS_AI_CONFIG.geminiEmbeddingModel });

      const result = await Promise.race([
        embModel.embedContent(cleanText),
        this.timeout(POS_AI_CONFIG.requestTimeoutMs),
      ]);

      if (!result) throw new Error('Embedding request timed out');

      const embedding = (result as any).embedding?.values;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response structure');
      }

      // Cache it
      this.cache.set(cleanText, {
        embedding,
        expiresAt: Date.now() + POS_AI_CONFIG.embeddingCacheTtlMs,
      });

      // Keep cache under control
      if (this.cache.size > 5000) {
        const now = Date.now();
        for (const [key, val] of this.cache) {
          if (val.expiresAt < now) this.cache.delete(key);
        }
      }

      this.logger.debug(`Embedding generated: "${cleanText.substring(0, 40)}..." (${embedding.length}d)`);
      return { text: cleanText, embedding, dimensions: embedding.length };
    } catch (err: any) {
      this.logger.error(`Embedding error for "${cleanText.substring(0, 30)}": ${err.message}`);
      return null;
    }
  }

  /**
   * Generate embeddings for multiple texts (batched)
   */
  async generateBatchEmbeddings(texts: string[]): Promise<(EmbeddingResult | null)[]> {
    if (!this.gemini.isAvailable()) {
      return texts.map(() => null);
    }

    const results: (EmbeddingResult | null)[] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += POS_AI_CONFIG.batchSize) {
      const batch = texts.slice(i, i + POS_AI_CONFIG.batchSize);
      const batchResults = await Promise.all(
        batch.map((text) => this.generateEmbedding(text)),
      );
      results.push(...batchResults);

      // Small delay between batches to avoid rate limiting
      if (i + POS_AI_CONFIG.batchSize < texts.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const successCount = results.filter(Boolean).length;
    this.logger.log(`Batch embeddings: ${successCount}/${texts.length} succeeded`);
    return results;
  }

  /** Clear the embedding cache */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('Embedding cache cleared');
  }

  private timeout(ms: number): Promise<null> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
  }
}
