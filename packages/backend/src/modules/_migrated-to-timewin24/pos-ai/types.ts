// ── pos-ai/types.ts ─────────────────────────────────────────────
// Shared types for the POS AI module
// ─────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  dimensions: number;
}

export interface SemanticSearchResult {
  productId: string;
  name: string;
  ean: string | null;
  categoryId: string | null;
  priceMinorUnits: number;
  score: number; // cosine similarity 0-1
  stockQuantity: number;
}

export interface NaturalQueryResult {
  intent: 'search' | 'similar' | 'category_browse' | 'price_filter' | 'unknown';
  extractedTerms: string[];
  filters: {
    category?: string;
    maxPrice?: number;
    minPrice?: number;
  };
  products: SemanticSearchResult[];
  fallbackUsed: boolean;
  processingTimeMs: number;
}

export interface AnomalyAlert {
  type: 'duplicate' | 'naming_error' | 'category_mismatch' | 'variant_incoherent' | 'too_similar';
  severity: 'low' | 'medium' | 'high';
  productIds: string[];
  productNames: string[];
  score: number;
  message: string;
  suggestion: string;
}

export interface AssistantResponse {
  answer: string;
  relatedProducts: SemanticSearchResult[];
  confidence: number;
  source: 'embeddings' | 'gemini' | 'rules';
}

export interface SyncResult {
  totalProducts: number;
  synced: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

export interface PosAiHealthStatus {
  enabled: boolean;
  gemini: { connected: boolean; model: string; error?: string };
  vectorStore: { available: boolean; totalEmbeddings: number; error?: string };
  lastSync: string | null;
}
