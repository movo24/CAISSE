// ── pos-ai/anomaly-insights.ts ──────────────────────────────────
// Product catalog anomaly detection via embeddings
// ─────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductEntity } from '../../database/entities/product.entity';
import { VectorStoreService } from './vector-store';
import { AnomalyAlert } from './types';

@Injectable()
export class AnomalyInsightsService {
  private readonly logger = new Logger('POS-AI:Anomalies');

  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    private readonly vectorStore: VectorStoreService,
  ) {}

  /**
   * Run full anomaly scan on a store's product catalog
   */
  async scanAnomalies(storeId: string): Promise<AnomalyAlert[]> {
    const alerts: AnomalyAlert[] = [];
    const startTime = Date.now();

    // 1. Semantic duplicates (via vector similarity)
    const duplicates = await this.detectSemanticDuplicates(storeId);
    alerts.push(...duplicates);

    // 2. Naming issues (rule-based)
    const namingIssues = await this.detectNamingIssues(storeId);
    alerts.push(...namingIssues);

    // 3. Category inconsistencies
    const categoryIssues = await this.detectCategoryIssues(storeId);
    alerts.push(...categoryIssues);

    // Sort by severity then score
    const severityOrder = { high: 0, medium: 1, low: 2 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.score - a.score);

    this.logger.log(`Anomaly scan complete: ${alerts.length} alerts (${Date.now() - startTime}ms)`);
    return alerts;
  }

  /**
   * Detect near-duplicate products using cosine similarity
   */
  private async detectSemanticDuplicates(storeId: string): Promise<AnomalyAlert[]> {
    const alerts: AnomalyAlert[] = [];

    if (!this.vectorStore.isAvailable()) {
      this.logger.warn('Vector store unavailable — skipping duplicate detection');
      return alerts;
    }

    const duplicates = await this.vectorStore.findDuplicates(storeId, 0.85, 30);

    for (const dup of duplicates) {
      const severity = dup.score >= 0.95 ? 'high' : dup.score >= 0.9 ? 'medium' : 'low';
      alerts.push({
        type: dup.score >= 0.95 ? 'duplicate' : 'too_similar',
        severity,
        productIds: [dup.productA, dup.productB],
        productNames: [dup.nameA, dup.nameB],
        score: dup.score,
        message: `Produits tres similaires (${Math.round(dup.score * 100)}% de similarite)`,
        suggestion: dup.score >= 0.95
          ? `Verifier si "${dup.nameA}" et "${dup.nameB}" sont le meme produit. Envisager fusion.`
          : `"${dup.nameA}" et "${dup.nameB}" sont proches. Verifier si les noms ou descriptions doivent etre differencies.`,
      });
    }

    return alerts;
  }

  /**
   * Detect naming problems using text analysis rules
   */
  private async detectNamingIssues(storeId: string): Promise<AnomalyAlert[]> {
    const alerts: AnomalyAlert[] = [];

    const products = await this.productRepo.find({
      where: { storeId, isActive: true },
      select: ['id', 'name', 'description', 'categoryId'],
    });

    for (const p of products) {
      // Very short names (< 3 chars)
      if (p.name.trim().length < 3) {
        alerts.push({
          type: 'naming_error',
          severity: 'medium',
          productIds: [p.id],
          productNames: [p.name],
          score: 0.9,
          message: `Nom de produit trop court: "${p.name}"`,
          suggestion: 'Ajouter un nom plus descriptif pour faciliter la recherche.',
        });
      }

      // Names that are just numbers
      if (/^\d+$/.test(p.name.trim())) {
        alerts.push({
          type: 'naming_error',
          severity: 'high',
          productIds: [p.id],
          productNames: [p.name],
          score: 0.95,
          message: `Nom de produit numerique uniquement: "${p.name}"`,
          suggestion: 'Remplacer par un nom descriptif du produit.',
        });
      }

      // Excessive capitalization
      if (p.name.length > 5 && p.name === p.name.toUpperCase()) {
        alerts.push({
          type: 'naming_error',
          severity: 'low',
          productIds: [p.id],
          productNames: [p.name],
          score: 0.6,
          message: `Nom tout en majuscules: "${p.name}"`,
          suggestion: 'Utiliser la casse normale pour une meilleure lisibilite.',
        });
      }
    }

    // Detect near-identical names (Levenshtein-like check)
    for (let i = 0; i < products.length; i++) {
      for (let j = i + 1; j < products.length; j++) {
        const nameA = products[i].name.toLowerCase().trim();
        const nameB = products[j].name.toLowerCase().trim();

        // Simple character overlap check (lightweight)
        if (nameA.length > 3 && nameB.length > 3) {
          // Check if one name is a substring of the other
          if (nameA.includes(nameB) || nameB.includes(nameA)) {
            alerts.push({
              type: 'too_similar',
              severity: 'medium',
              productIds: [products[i].id, products[j].id],
              productNames: [products[i].name, products[j].name],
              score: 0.8,
              message: `Un nom est inclus dans l'autre: "${products[i].name}" et "${products[j].name}"`,
              suggestion: 'Verifier si ce sont des variantes du meme produit ou des produits differents mal nommes.',
            });
          }
        }
      }
    }

    return alerts;
  }

  /**
   * Detect category inconsistencies
   */
  private async detectCategoryIssues(storeId: string): Promise<AnomalyAlert[]> {
    const alerts: AnomalyAlert[] = [];

    const products = await this.productRepo.find({
      where: { storeId, isActive: true },
      select: ['id', 'name', 'categoryId'],
    });

    // Products without category
    const noCategory = products.filter((p) => !p.categoryId);
    if (noCategory.length > 0) {
      alerts.push({
        type: 'category_mismatch',
        severity: 'low',
        productIds: noCategory.slice(0, 10).map((p) => p.id),
        productNames: noCategory.slice(0, 10).map((p) => p.name),
        score: 0.5,
        message: `${noCategory.length} produit(s) sans categorie assignee`,
        suggestion: 'Assigner une categorie pour ameliorer la recherche et le classement.',
      });
    }

    // Categories with very few products (< 2) — possibly misassigned
    const catCounts = new Map<string, { count: number; products: ProductEntity[] }>();
    for (const p of products) {
      if (!p.categoryId) continue;
      const entry = catCounts.get(p.categoryId) || { count: 0, products: [] };
      entry.count++;
      entry.products.push(p);
      catCounts.set(p.categoryId, entry);
    }

    for (const [cat, data] of catCounts) {
      if (data.count === 1) {
        alerts.push({
          type: 'category_mismatch',
          severity: 'low',
          productIds: data.products.map((p) => p.id),
          productNames: data.products.map((p) => p.name),
          score: 0.4,
          message: `Categorie "${cat}" ne contient qu'un seul produit`,
          suggestion: `Verifier si "${data.products[0].name}" appartient bien a cette categorie ou s'il devrait etre regroupe ailleurs.`,
        });
      }
    }

    return alerts;
  }
}
