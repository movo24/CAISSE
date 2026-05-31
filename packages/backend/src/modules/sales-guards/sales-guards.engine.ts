import {
  EvaluateSaleGuardsInput,
  GUARD_CODE,
  SaleGuardResult,
} from './sales-guards.types';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const euros = (minor: number): string => (minor / 100).toFixed(2);

/**
 * PURE, READ-ONLY guard engine.
 *
 * Given a cart and config thresholds, returns the list of anomalies detected.
 * No I/O, no mutation — fully unit-testable. Persistence and escalation are the
 * caller's responsibility (SalesGuardsService).
 */
export function evaluateSaleGuards(
  input: EvaluateSaleGuardsInput,
): SaleGuardResult[] {
  const results: SaleGuardResult[] = [];
  const cfg = input.config;

  if (!cfg.enabled) return results;

  for (const item of input.items) {
    const productId = item.productId;
    const sell = item.sellPriceMinorUnits;
    const catalog = item.catalogPriceMinorUnits;
    const cost = item.costMinorUnits;
    const qty = item.quantity > 0 ? item.quantity : 1;
    const name = item.productName ?? 'ce produit';

    // ── 3 / 8: cost missing → cannot verify margin ──
    if (cost === null || cost === undefined) {
      results.push({
        code: GUARD_CODE.COST_MISSING,
        severity: 'warning',
        blocking: false,
        managerApprovalRequired: false,
        message: `Coût non renseigné pour ${name} — marge non vérifiable`,
        productId,
        metadata: { sellPriceMinorUnits: sell },
      });
    } else {
      const marginPerUnit = sell - cost;
      const marginPct = sell > 0 ? (marginPerUnit / sell) * 100 : marginPerUnit < 0 ? -100 : 0;

      // ── 1 / 9: below cost (negative margin) ──
      if (sell < cost) {
        results.push({
          code: GUARD_CODE.SALE_BELOW_COST,
          severity: 'critical',
          blocking: true,
          managerApprovalRequired: true,
          message: `Vente sous le coût : ${euros(sell)}€ < coût ${euros(cost)}€`,
          productId,
          metadata: {
            sellPriceMinorUnits: sell,
            costMinorUnits: cost,
            marginPerUnitMinorUnits: marginPerUnit,
          },
        });
      } else if (marginPct < cfg.lowMarginThresholdPct) {
        // ── 2: low margin (positive but thin) ──
        results.push({
          code: GUARD_CODE.LOW_MARGIN,
          severity: 'warning',
          blocking: false,
          managerApprovalRequired: false,
          message: `Marge faible (${marginPct.toFixed(1)} %) — vérifier prix`,
          productId,
          metadata: { marginPct: round2(marginPct), threshold: cfg.lowMarginThresholdPct },
        });
      }

      // ── 6: suspicious recent price change producing negative margin ──
      if (item.recentPriceChange && marginPerUnit < 0) {
        results.push({
          code: GUARD_CODE.SUSPICIOUS_PRICE_CHANGE,
          severity: 'warning',
          blocking: false,
          managerApprovalRequired: false,
          message: `Changement de prix récent : marge négative sur ${name}`,
          productId,
          metadata: { sellPriceMinorUnits: sell, costMinorUnits: cost },
        });
      }
    }

    // ── 4 / 7: manual price override vs catalogue ──
    if (item.manualPriceOverride && catalog > 0) {
      const deviationPct = ((sell - catalog) / catalog) * 100;
      const absDev = Math.abs(deviationPct);

      if (absDev >= cfg.manualPriceDeviationBlockPct) {
        results.push({
          code: GUARD_CODE.MANUAL_PRICE_OVERRIDE_HIGH,
          severity: 'critical',
          blocking: true,
          managerApprovalRequired: true,
          message: `Prix manuel ${euros(sell)}€ s'écarte de ${deviationPct.toFixed(1)} % du catalogue`,
          productId,
          metadata: {
            sellPriceMinorUnits: sell,
            catalogPriceMinorUnits: catalog,
            deviationPct: round2(deviationPct),
          },
        });
      } else if (absDev >= cfg.manualPriceDeviationWarnPct) {
        results.push({
          code: GUARD_CODE.MANUAL_PRICE_OVERRIDE,
          severity: 'warning',
          blocking: false,
          managerApprovalRequired: false,
          message: `Prix manuel appliqué (${deviationPct.toFixed(1)} % vs catalogue)`,
          productId,
          metadata: {
            sellPriceMinorUnits: sell,
            catalogPriceMinorUnits: catalog,
            deviationPct: round2(deviationPct),
          },
        });
      }
    }

    // ── 5: excessive discount (per line) ──
    const discount = item.discountMinorUnits ?? 0;
    const lineGross = sell * qty;
    if (discount > 0 && lineGross > 0) {
      const discountPct = (discount / lineGross) * 100;
      if (discountPct > cfg.excessiveDiscountThresholdPct) {
        results.push({
          code: GUARD_CODE.EXCESSIVE_DISCOUNT,
          severity: 'warning',
          blocking: false,
          managerApprovalRequired: true,
          message: `Remise élevée (${discountPct.toFixed(1)} %) — validation manager requise`,
          productId,
          metadata: {
            discountMinorUnits: discount,
            lineGrossMinorUnits: lineGross,
            discountPct: round2(discountPct),
            threshold: cfg.excessiveDiscountThresholdPct,
          },
        });
      }
    }
  }

  // ── 6 (free product abuse) — cart/seller level ──
  if (
    input.freeProductUsageCount !== undefined &&
    input.freeProductUsageCount > cfg.freeProductDailyThreshold
  ) {
    results.push({
      code: GUARD_CODE.FREE_PRODUCT_ABUSE,
      severity: 'warning',
      blocking: false,
      managerApprovalRequired: false,
      message: `Produit libre utilisé ${input.freeProductUsageCount}× aujourd'hui (seuil ${cfg.freeProductDailyThreshold})`,
      metadata: {
        count: input.freeProductUsageCount,
        threshold: cfg.freeProductDailyThreshold,
      },
    });
  }

  // ── 7 (repeated cancellations) — seller level ──
  if (
    input.cancellationCount !== undefined &&
    input.cancellationCount > cfg.cancellationThreshold
  ) {
    results.push({
      code: GUARD_CODE.REPEATED_CANCELLATIONS,
      severity: 'warning',
      blocking: false,
      managerApprovalRequired: false,
      message: `Annulations répétées (${input.cancellationCount}) — au-dessus du seuil ${cfg.cancellationThreshold}`,
      metadata: {
        count: input.cancellationCount,
        threshold: cfg.cancellationThreshold,
      },
    });
  }

  return results;
}
