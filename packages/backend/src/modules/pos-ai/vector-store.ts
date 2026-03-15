// ── pos-ai/vector-store.ts ──────────────────────────────────────
// pgvector-based vector store for product embeddings
// Uses raw SQL with TypeORM — no extra ORM dependency needed
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { POS_AI_CONFIG } from './config';
import { SemanticSearchResult } from './types';

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger('POS-AI:VectorStore');
  private ready = false;

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    if (!POS_AI_CONFIG.enabled) return;
    await this.ensureTable();
  }

  /** Create the product_embeddings table if it doesn't exist */
  private async ensureTable(): Promise<void> {
    try {
      // Ensure pgvector extension
      await this.dataSource.query(`CREATE EXTENSION IF NOT EXISTS vector`);

      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS product_embeddings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id UUID NOT NULL UNIQUE,
          store_id VARCHAR(255) NOT NULL,
          semantic_text TEXT NOT NULL,
          embedding vector(${POS_AI_CONFIG.embeddingDimensions}) NOT NULL,
          metadata JSONB DEFAULT '{}',
          synced_at TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT fk_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
      `);

      // Index for cosine similarity search (IVFFlat for speed)
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_product_embeddings_store
        ON product_embeddings (store_id)
      `);

      // HNSW index for fast approximate nearest neighbor search
      const indexExists = await this.dataSource.query(`
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_product_embeddings_hnsw'
      `);
      if (indexExists.length === 0) {
        // Only create HNSW if we have some data (avoids empty index issues)
        const count = await this.dataSource.query(`SELECT COUNT(*) as c FROM product_embeddings`);
        if (parseInt(count[0]?.c || '0') > 0) {
          await this.dataSource.query(`
            CREATE INDEX idx_product_embeddings_hnsw
            ON product_embeddings USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64)
          `);
          this.logger.log('HNSW index created for fast vector search');
        }
      }

      this.ready = true;
      this.logger.log('Vector store initialized (product_embeddings table ready)');
    } catch (err: any) {
      this.logger.error(`Vector store init failed: ${err.message}`);
      this.ready = false;
    }
  }

  isAvailable(): boolean {
    return this.ready;
  }

  /**
   * Upsert a product embedding (insert or update)
   */
  async upsertProductEmbedding(
    productId: string,
    storeId: string,
    semanticText: string,
    embedding: number[],
    metadata: Record<string, any> = {},
  ): Promise<boolean> {
    if (!this.ready) return false;

    try {
      const vectorStr = `[${embedding.join(',')}]`;
      await this.dataSource.query(
        `
        INSERT INTO product_embeddings (product_id, store_id, semantic_text, embedding, metadata, synced_at)
        VALUES ($1, $2, $3, $4::vector, $5::jsonb, NOW())
        ON CONFLICT (product_id) DO UPDATE SET
          store_id = EXCLUDED.store_id,
          semantic_text = EXCLUDED.semantic_text,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata,
          synced_at = NOW()
        `,
        [productId, storeId, semanticText, vectorStr, JSON.stringify(metadata)],
      );
      return true;
    } catch (err: any) {
      this.logger.error(`Upsert failed for product ${productId}: ${err.message}`);
      return false;
    }
  }

  /**
   * Cosine similarity search — the core of semantic product search
   */
  async searchSimilarProducts(
    storeId: string,
    queryEmbedding: number[],
    limit: number = POS_AI_CONFIG.defaultSearchLimit,
  ): Promise<SemanticSearchResult[]> {
    if (!this.ready) return [];

    try {
      const vectorStr = `[${queryEmbedding.join(',')}]`;
      const rows = await this.dataSource.query(
        `
        SELECT
          pe.product_id AS "productId",
          p.name,
          p.ean,
          p.category_id AS "categoryId",
          p.price_minor_units AS "priceMinorUnits",
          p.stock_quantity AS "stockQuantity",
          1 - (pe.embedding <=> $1::vector) AS score
        FROM product_embeddings pe
        JOIN products p ON p.id = pe.product_id
        WHERE pe.store_id = $2
          AND p.is_active = true
          AND 1 - (pe.embedding <=> $1::vector) >= $4
        ORDER BY pe.embedding <=> $1::vector ASC
        LIMIT $3
        `,
        [vectorStr, storeId, limit, POS_AI_CONFIG.similarityThreshold],
      );

      return rows.map((r: any) => ({
        productId: r.productId,
        name: r.name,
        ean: r.ean,
        categoryId: r.categoryId,
        priceMinorUnits: Number(r.priceMinorUnits),
        stockQuantity: Number(r.stockQuantity),
        score: Math.round(Number(r.score) * 1000) / 1000,
      }));
    } catch (err: any) {
      this.logger.error(`Vector search failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Find near-duplicate products (for anomaly detection)
   */
  async findDuplicates(
    storeId: string,
    minSimilarity: number = 0.85,
    limit: number = 50,
  ): Promise<Array<{ productA: string; nameA: string; productB: string; nameB: string; score: number }>> {
    if (!this.ready) return [];

    try {
      const rows = await this.dataSource.query(
        `
        SELECT
          a.product_id AS "productA",
          pa.name AS "nameA",
          b.product_id AS "productB",
          pb.name AS "nameB",
          1 - (a.embedding <=> b.embedding) AS score
        FROM product_embeddings a
        JOIN product_embeddings b ON a.store_id = b.store_id AND a.product_id < b.product_id
        JOIN products pa ON pa.id = a.product_id
        JOIN products pb ON pb.id = b.product_id
        WHERE a.store_id = $1
          AND 1 - (a.embedding <=> b.embedding) >= $2
        ORDER BY score DESC
        LIMIT $3
        `,
        [storeId, minSimilarity, limit],
      );

      return rows.map((r: any) => ({
        productA: r.productA,
        nameA: r.nameA,
        productB: r.productB,
        nameB: r.nameB,
        score: Math.round(Number(r.score) * 1000) / 1000,
      }));
    } catch (err: any) {
      this.logger.error(`Duplicate search failed: ${err.message}`);
      return [];
    }
  }

  /** Count total embeddings for a store */
  async countEmbeddings(storeId?: string): Promise<number> {
    if (!this.ready) return 0;
    try {
      const where = storeId ? 'WHERE store_id = $1' : '';
      const params = storeId ? [storeId] : [];
      const result = await this.dataSource.query(
        `SELECT COUNT(*) as count FROM product_embeddings ${where}`,
        params,
      );
      return parseInt(result[0]?.count || '0');
    } catch {
      return 0;
    }
  }

  /** Delete all embeddings for a store (for re-sync) */
  async clearStore(storeId: string): Promise<number> {
    if (!this.ready) return 0;
    const result = await this.dataSource.query(
      `DELETE FROM product_embeddings WHERE store_id = $1`,
      [storeId],
    );
    return result[1] || 0;
  }
}
