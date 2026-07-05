import { useEffect, useRef } from 'react';
import { usePOSStore } from '../stores/posStore';
import { posEventBus } from '../services/posEventBus';
import { getCustomerDisplayBus } from '../services/customerDisplay/bus';
import { buildSnapshot, type SnapshotBranding } from '../services/customerDisplay/snapshot';
import { loadSettings, terminalLabel } from '../services/customerDisplay/settings';

/**
 * CustomerDisplayPublisher — inert bridge mounted once in the operator window.
 *
 * It READS the POS store and LISTENS to the existing event bus, then broadcasts
 * a customer-safe snapshot + payment phase to the client display over
 * BroadcastChannel. It never mutates cart/payment/fiscal state and renders
 * nothing. If the display window is closed or BroadcastChannel is unavailable,
 * every post is a harmless no-op — the register is unaffected.
 */
export function CustomerDisplayPublisher() {
  const saleCompletedSinceOpen = useRef(false);
  const lastModalOpen = useRef(false);
  const lastSnapshotKey = useRef('');

  useEffect(() => {
    const bus = getCustomerDisplayBus();

    const branding = (): SnapshotBranding => {
      const s = loadSettings();
      const st = usePOSStore.getState();
      return {
        storeName: st.storeInfo?.storeName || s.storeName,
        terminalLabel: terminalLabel(s.terminalId),
      };
    };

    const postSnapshot = () => {
      const st = usePOSStore.getState();
      const snapshot = buildSnapshot(
        {
          items: st.cartItems.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unitPriceMinorUnits: i.unitPriceMinorUnits,
            discountMinorUnits: i.discountMinorUnits,
          })),
          subtotalMinorUnits: st.subtotal(),
          totalDiscountMinorUnits: st.totalDiscount(),
          totalMinorUnits: st.total(),
          customer: st.customer
            ? {
                firstName: st.customer.firstName,
                loyaltyPoints: st.customer.loyaltyPoints,
                isFirstPurchase: st.customer.isFirstPurchase,
              }
            : null,
        },
        branding(),
        new Date().toISOString(),
      );

      // Skip identical repeats (except the timestamp) to keep the bus quiet.
      const { at, ...rest } = snapshot;
      const key = JSON.stringify(rest);
      if (key === lastSnapshotKey.current) return;
      lastSnapshotKey.current = key;
      bus.post({ type: 'snapshot', snapshot });
    };

    // Initial push so a display that is already open reflects current state.
    postSnapshot();

    // ── React to cart/customer/total changes ──
    const unsubStore = usePOSStore.subscribe((state, prev) => {
      if (
        state.cartItems !== prev.cartItems ||
        state.customer !== prev.customer ||
        state.manualDiscountMinorUnits !== prev.manualDiscountMinorUnits ||
        state.promoDiscountInfo !== prev.promoDiscountInfo ||
        state.storeInfo !== prev.storeInfo
      ) {
        postSnapshot();
      }

      // ── Payment phase: pending on modal open, cancel → none ──
      if (state.paymentModalOpen !== lastModalOpen.current) {
        lastModalOpen.current = state.paymentModalOpen;
        if (state.paymentModalOpen) {
          saleCompletedSinceOpen.current = false;
          bus.post({
            type: 'payment',
            phase: 'pending',
            amountMinorUnits: state.total(),
            changeMinorUnits: 0,
            method: null,
          });
        } else if (!saleCompletedSinceOpen.current) {
          bus.post({ type: 'payment', phase: 'none', amountMinorUnits: 0, changeMinorUnits: 0, method: null });
        }
      }
    });

    // ── Sale completed → success ──
    const offCompleted = posEventBus.on('SALE_COMPLETED', (p) => {
      saleCompletedSinceOpen.current = true;
      bus.post({
        type: 'payment',
        phase: 'success',
        amountMinorUnits: p.totalMinorUnits,
        changeMinorUnits: 0,
        method: p.paymentMethod,
      });
    });

    // ── Sale error → failed (neutral message on the customer screen) ──
    const offError = posEventBus.on('SALE_ERROR', () => {
      bus.post({ type: 'payment', phase: 'failed', amountMinorUnits: 0, changeMinorUnits: 0, method: null });
    });

    return () => {
      unsubStore();
      offCompleted();
      offError();
    };
  }, []);

  return null;
}
