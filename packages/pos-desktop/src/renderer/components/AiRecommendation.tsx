// ── AiRecommendation ─────────────────────────────────────────────
// Shows AI-powered upsell suggestions when cart has items.
// Fetches from /sales-ai/recommendations with current cart.
// Shows NOTHING if AI has no confident recommendation (silence-first).
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react';
import { Sparkles, Plus, X, TrendingUp, AlertTriangle, ShieldCheck } from 'lucide-react';
import { usePOSStore } from '../stores/posStore';
import { salesAiApi, productsApi } from '../services/api';

interface Recommendation {
  type: 'upsell' | 'alert' | 'insight' | 'silence';
  message: string;
  why: string;
  confidence: number;
  impact: string;
  actionability: 'immediate' | 'watch' | 'info';
  evidence: string[];
  productId?: string;
  productName?: string;
  suggestedProductId?: string;
  suggestedProductName?: string;
}

const FETCH_DEBOUNCE_MS = 2000; // Don't spam API on rapid cart changes
const DISMISS_DURATION_MS = 12000; // Auto-hide after 12s
const COOLDOWN_MS = 120000; // 2 min cooldown between recommendations
const MAX_RECOS_PER_SESSION = 1; // Only 1 recommendation at a time

export function AiRecommendation() {
  const cartItems = usePOSStore((s) => s.cartItems);
  const addToCart = usePOSStore((s) => s.addToCart);

  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCartRef = useRef('');
  const lastRecoTimeRef = useRef(0);
  const shownThisSessionRef = useRef<Set<string>>(new Set());
  const logIdsRef = useRef<Map<string, string>>(new Map()); // suggestedProductId → logId

  // Fetch recommendations when cart changes (debounced)
  useEffect(() => {
    const cartKey = cartItems.map((i) => i.productId).sort().join(',');

    // Skip if cart unchanged or empty
    if (cartKey === lastCartRef.current || cartItems.length === 0) {
      if (cartItems.length === 0) {
        setRecommendations([]);
        setDismissed(new Set());
        shownThisSessionRef.current = new Set(); // Reset session on empty cart
      }
      return;
    }
    lastCartRef.current = cartKey;

    // Cooldown: don't fetch if we showed a reco less than 2 min ago
    if (Date.now() - lastRecoTimeRef.current < COOLDOWN_MS) return;

    // Debounce
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const productIds = cartItems.map((i) => i.productId);
        const res = await salesAiApi.recommendations(productIds);
        const recs: Recommendation[] = Array.isArray(res.data) ? res.data : [];

        // Only show actionable, not-yet-shown, high-confidence recommendations
        const actionable = recs.filter(
          (r) =>
            r.type !== 'silence' &&
            r.confidence >= 0.75 &&
            r.suggestedProductId &&
            !shownThisSessionRef.current.has(r.suggestedProductId)
        );

        // Max 1 recommendation per transaction
        const limited = actionable.slice(0, MAX_RECOS_PER_SESSION);

        // Track shown recommendations (never show same one twice in session)
        limited.forEach((r) => {
          if (r.suggestedProductId) shownThisSessionRef.current.add(r.suggestedProductId);
        });

        if (limited.length > 0) {
          lastRecoTimeRef.current = Date.now();
          // Log display for learning (fire-and-forget)
          for (const rec of limited) {
            if (rec.suggestedProductId && rec.productId) {
              salesAiApi.logDisplay({
                triggerProductId: rec.productId,
                triggerProductName: rec.productName || '',
                suggestedProductId: rec.suggestedProductId,
                suggestedProductName: rec.suggestedProductName || '',
                confidence: rec.confidence,
                estimatedCashImpact: 0,
                marginPercent: 0,
              }).then((res) => {
                if (res.data?.logId && rec.suggestedProductId) {
                  logIdsRef.current.set(rec.suggestedProductId, res.data.logId);
                }
              }).catch(() => {}); // Never block POS
            }
          }
        }
        setRecommendations(limited);

        // Auto-dismiss after 15s
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        if (actionable.length > 0) {
          dismissTimerRef.current = setTimeout(() => {
            setRecommendations([]);
          }, DISMISS_DURATION_MS);
        }
      } catch {
        // AI unavailable → silence (never block the POS)
        setRecommendations([]);
      } finally {
        setLoading(false);
      }
    }, FETCH_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cartItems]);

  // Clean up on unmount
  useEffect(() => () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  }, []);

  // Handle "add to cart" from recommendation
  const handleAddSuggested = async (rec: Recommendation) => {
    if (!rec.suggestedProductId) return;

    // Log click (fire-and-forget)
    const logId = logIdsRef.current.get(rec.suggestedProductId);
    if (logId) {
      salesAiApi.logClick(logId).catch(() => {});
    }

    try {
      const res = await productsApi.get(rec.suggestedProductId);
      const p = res.data;
      if (p && p.id) {
        addToCart({
          productId: p.id,
          ean: p.ean || '',
          name: p.name,
          unitPriceMinorUnits: p.priceMinorUnits,
        });

        // Log add-to-cart (fire-and-forget)
        if (logId) {
          salesAiApi.logAddToCart(logId).catch(() => {});
        }

        setDismissed((prev) => new Set(prev).add(rec.suggestedProductId!));
      }
    } catch {
      // Product fetch failed → ignore
    }
  };

  const handleDismiss = (sugId: string) => {
    setDismissed((prev) => new Set(prev).add(sugId));
  };

  // Filter out dismissed
  const visible = recommendations.filter(
    (r) => r.suggestedProductId && !dismissed.has(r.suggestedProductId)
  );

  // Nothing to show → render nothing (silence)
  if (visible.length === 0) return null;

  return (
    <div className="px-2 pb-2">
      {visible.slice(0, MAX_RECOS_PER_SESSION).map((rec) => {
        const isUpsell = rec.type === 'upsell';
        const isAlert = rec.type === 'alert';

        return (
          <div
            key={rec.suggestedProductId || rec.message}
            className={`flex items-center gap-2 p-2.5 rounded-xl mb-1.5 border transition-all animate-fade-in ${
              isAlert
                ? 'bg-amber-50 border-amber-200'
                : 'bg-violet-50 border-violet-200'
            }`}
          >
            {/* Icon */}
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
              isAlert ? 'bg-amber-100' : 'bg-violet-100'
            }`}>
              {isAlert ? (
                <AlertTriangle size={14} className="text-amber-600" />
              ) : (
                <Sparkles size={14} className="text-violet-600" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className={`text-[11px] font-bold leading-tight ${
                isAlert ? 'text-amber-800' : 'text-violet-800'
              }`}>
                {rec.message}
              </p>
              <p className="text-[9px] text-gray-500 mt-0.5 leading-tight truncate">
                {rec.why}
              </p>
              {/* Confidence badge */}
              <div className="flex items-center gap-1 mt-1">
                <ShieldCheck size={8} className="text-gray-400" />
                <span className="text-[8px] text-gray-400 font-semibold">
                  {Math.round(rec.confidence * 100)}% confiance
                </span>
                {rec.impact && (
                  <>
                    <span className="text-[8px] text-gray-300">•</span>
                    <TrendingUp size={8} className="text-emerald-500" />
                    <span className="text-[8px] text-emerald-600 font-semibold">
                      {rec.impact}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {isUpsell && rec.suggestedProductId && (
                <button
                  onClick={() => handleAddSuggested(rec)}
                  className="w-8 h-8 rounded-lg bg-violet-600 text-white flex items-center justify-center active:scale-90 transition-transform"
                  title="Ajouter au panier"
                >
                  <Plus size={16} strokeWidth={2.5} />
                </button>
              )}
              <button
                onClick={() => handleDismiss(rec.suggestedProductId || rec.message)}
                className="w-6 h-6 rounded-md text-gray-300 hover:text-gray-500 flex items-center justify-center"
                title="Ignorer"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
