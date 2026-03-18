// ── pos-ai/natural-query.ts ─────────────────────────────────────
// Natural language query understanding for POS
// Rule-based first, Gemini fallback for complex queries
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { GeminiClientService } from './gemini-client';
import { ProductSearchService } from './product-search';
import { NaturalQueryResult } from './types';

// ── Intent patterns (French + English) ──
const INTENT_PATTERNS = {
  search: [
    /(?:cherche|trouve|montre|affiche|voir|donne|search|find|show)/i,
    /(?:produit|article|item)/i,
  ],
  similar: [
    /(?:similaire|ressemble|comme|pareil|equivalent|alternative|similar)/i,
  ],
  category_browse: [
    /(?:categorie|rayon|famille|category|section)/i,
    /(?:tous les|toutes les|all|liste)/i,
  ],
  price_filter: [
    /(?:pas cher|moins cher|cheap|abordable|petit prix|budget|discount|promo)/i,
    /(?:moins de|under|below|max)\s*(\d+)/i,
    /(?:plus de|above|over|min)\s*(\d+)/i,
  ],
};

// ── Price extraction patterns ──
const PRICE_PATTERNS = {
  maxPrice: /(?:moins de|under|below|max|pas plus de)\s*(\d+(?:[.,]\d+)?)\s*(?:euros?)?/i,
  minPrice: /(?:plus de|above|over|min|au moins)\s*(\d+(?:[.,]\d+)?)\s*(?:euros?)?/i,
};

// ── Stop words to remove for cleaner search ──
const STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux',
  'et', 'ou', 'en', 'pour', 'avec', 'dans', 'sur', 'je', 'veux', 'voudrais',
  'cherche', 'trouve', 'montre', 'affiche', 'voir', 'donne', 'moi',
  'est', 'ce', 'qui', 'que', 'quoi', 'il', 'elle', 'on', 'nous',
  'the', 'an', 'is', 'are', 'for', 'me', 'my', 'want',
  'find', 'show', 'search', 'get', 'give',
]);

@Injectable()
export class NaturalQueryService {
  private readonly logger = new Logger('POS-AI:NaturalQuery');

  constructor(
    private readonly gemini: GeminiClientService,
    private readonly productSearch: ProductSearchService,
  ) {}

  /**
   * Process a natural language query into structured product search
   */
  async processQuery(storeId: string, query: string, limit: number = 10): Promise<NaturalQueryResult> {
    const startTime = Date.now();

    // 1. Detect intent
    const intent = this.detectIntent(query);

    // 2. Extract terms and filters
    const extractedTerms = this.extractSearchTerms(query);
    const filters = this.extractFilters(query);

    // 3. Build search query
    let searchQuery = extractedTerms.join(' ');
    if (!searchQuery.trim()) searchQuery = query; // fallback to raw query

    // 4. Semantic search
    const { results, method } = await this.productSearch.semanticSearch(storeId, searchQuery, limit);

    // 5. Apply post-filters (price)
    let filteredResults = results;
    if (filters.maxPrice) {
      filteredResults = filteredResults.filter(
        (r) => r.priceMinorUnits <= filters.maxPrice! * 100,
      );
    }
    if (filters.minPrice) {
      filteredResults = filteredResults.filter(
        (r) => r.priceMinorUnits >= filters.minPrice! * 100,
      );
    }
    if (filters.category) {
      // Boost products matching category filter
      filteredResults = filteredResults.sort((a, b) => {
        const aMatch = a.categoryId?.toLowerCase().includes(filters.category!.toLowerCase()) ? 1 : 0;
        const bMatch = b.categoryId?.toLowerCase().includes(filters.category!.toLowerCase()) ? 1 : 0;
        return bMatch - aMatch || b.score - a.score;
      });
    }

    return {
      intent,
      extractedTerms,
      filters,
      products: filteredResults,
      fallbackUsed: method === 'fallback',
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Detect the user's intent from their query
   */
  private detectIntent(query: string): NaturalQueryResult['intent'] {
    const q = query.toLowerCase();

    for (const pattern of INTENT_PATTERNS.similar) {
      if (pattern.test(q)) return 'similar';
    }
    for (const pattern of INTENT_PATTERNS.price_filter) {
      if (pattern.test(q)) return 'price_filter';
    }
    for (const pattern of INTENT_PATTERNS.category_browse) {
      if (pattern.test(q)) return 'category_browse';
    }
    for (const pattern of INTENT_PATTERNS.search) {
      if (pattern.test(q)) return 'search';
    }

    // Default: if it looks like a product name, treat as search
    if (q.length > 2) return 'search';
    return 'unknown';
  }

  /**
   * Extract meaningful search terms from a query
   */
  private extractSearchTerms(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  }

  /**
   * Extract price and category filters from query
   */
  private extractFilters(query: string): NaturalQueryResult['filters'] {
    const filters: NaturalQueryResult['filters'] = {};

    const maxMatch = PRICE_PATTERNS.maxPrice.exec(query);
    if (maxMatch) {
      filters.maxPrice = parseFloat(maxMatch[1].replace(',', '.'));
    }

    const minMatch = PRICE_PATTERNS.minPrice.exec(query);
    if (minMatch) {
      filters.minPrice = parseFloat(minMatch[1].replace(',', '.'));
    }

    return filters;
  }

  /**
   * Use Gemini to understand a complex query (fallback for ambiguous cases)
   */
  async geminiQueryUnderstanding(query: string): Promise<{
    searchTerms: string[];
    category?: string;
    intent: string;
  } | null> {
    if (!this.gemini.isAvailable()) return null;

    const prompt = `Analyse cette requete POS (caisse de magasin) et extrais les termes de recherche produit.

Requete: "${query}"

Reponds UNIQUEMENT en JSON valide :
{
  "searchTerms": ["terme1", "terme2"],
  "category": "categorie si mentionnee ou null",
  "intent": "search|similar|category|price_filter"
}`;

    const response = await this.gemini.generate(prompt);
    if (!response) return null;

    try {
      const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      this.logger.warn('Failed to parse Gemini query understanding response');
      return null;
    }
  }
}
