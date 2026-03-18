// ── pos-ai/product-search.ts ────────────────────────────────────
// Semantic product search + catalog sync pipeline
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductEntity } from '../../database/entities/product.entity';
import { EmbeddingService } from './embeddings';
import { VectorStoreService } from './vector-store';
import { POS_AI_CONFIG } from './config';
import { SemanticSearchResult, SyncResult } from './types';

@Injectable()
export class ProductSearchService {
  private readonly logger = new Logger('POS-AI:ProductSearch');

  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    private readonly embeddings: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
  ) {}

  /**
   * Build a semantic text representation of a product
   * This text will be embedded for similarity search
   */
  buildSemanticText(product: ProductEntity): string {
    const parts: string[] = [];

    // Name is the most important
    parts.push(product.name);

    // Category adds context
    if (product.categoryId) {
      parts.push(product.categoryId);
    }

    // Description enriches understanding
    if (product.description) {
      parts.push(product.description);
    }

    // EAN can help with exact matches
    if (product.ean) {
      parts.push(`EAN:${product.ean}`);
    }

    // Price range hint
    const priceEur = (product.priceMinorUnits / 100).toFixed(2);
    parts.push(`${priceEur}€`);

    return parts.join(' | ');
  }

  /**
   * Sync all products from a store into the vector store
   * Idempotent — re-running updates existing embeddings
   */
  async syncProducts(storeId: string): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = { totalProducts: 0, synced: 0, skipped: 0, errors: 0, durationMs: 0 };

    if (!POS_AI_CONFIG.geminiAvailable) {
      this.logger.warn('Gemini not available — sync aborted');
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // Fetch all active products
    const products = await this.productRepo.find({
      where: { storeId, isActive: true },
      order: { name: 'ASC' },
    });
    result.totalProducts = products.length;
    this.logger.log(`Syncing ${products.length} products for store ${storeId}`);

    // Build semantic texts
    const semanticTexts = products.map((p) => this.buildSemanticText(p));

    // Generate embeddings in batch
    const embeddingResults = await this.embeddings.generateBatchEmbeddings(semanticTexts);

    // Upsert into vector store
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const embResult = embeddingResults[i];

      if (!embResult) {
        result.skipped++;
        continue;
      }

      const metadata = {
        name: product.name,
        ean: product.ean,
        categoryId: product.categoryId,
        priceMinorUnits: product.priceMinorUnits,
        stockQuantity: product.stockQuantity,
      };

      const ok = await this.vectorStore.upsertProductEmbedding(
        product.id,
        storeId,
        semanticTexts[i],
        embResult.embedding,
        metadata,
      );

      if (ok) {
        result.synced++;
      } else {
        result.errors++;
      }
    }

    result.durationMs = Date.now() - startTime;
    this.logger.log(
      `Sync complete: ${result.synced}/${result.totalProducts} synced, ` +
      `${result.skipped} skipped, ${result.errors} errors (${result.durationMs}ms)`,
    );
    return result;
  }

  /**
   * Semantic product search — the main entry point
   * Falls back to classic SQL LIKE if embeddings fail
   */
  async semanticSearch(
    storeId: string,
    query: string,
    limit: number = POS_AI_CONFIG.defaultSearchLimit,
  ): Promise<{ results: SemanticSearchResult[]; method: 'semantic' | 'fallback' }> {
    // Try semantic search first
    if (this.vectorStore.isAvailable() && POS_AI_CONFIG.geminiAvailable) {
      const embResult = await this.embeddings.generateEmbedding(query);
      if (embResult) {
        const results = await this.vectorStore.searchSimilarProducts(storeId, embResult.embedding, limit);
        if (results.length > 0) {
          return { results, method: 'semantic' };
        }
      }
    }

    // Fallback: classic SQL LIKE search
    this.logger.debug(`Semantic search unavailable for "${query}" — using fallback`);
    return { results: await this.fallbackSearch(storeId, query, limit), method: 'fallback' };
  }

  /**
   * Classic text search fallback (ILIKE)
   */
  private async fallbackSearch(storeId: string, query: string, limit: number): Promise<SemanticSearchResult[]> {
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    let qb = this.productRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.is_active = true');

    // Each term must match name, description, or categoryId
    terms.forEach((term, i) => {
      const param = `term${i}`;
      qb = qb.andWhere(
        `(p.name ILIKE :${param} OR p.description ILIKE :${param} OR p.category_id ILIKE :${param})`,
        { [param]: `%${term}%` },
      );
    });

    const products = await qb.orderBy('p.name', 'ASC').limit(limit).getMany();

    return products.map((p) => ({
      productId: p.id,
      name: p.name,
      ean: p.ean,
      categoryId: p.categoryId,
      priceMinorUnits: p.priceMinorUnits,
      stockQuantity: p.stockQuantity,
      score: 0.5, // flat score for fallback
    }));
  }
}
