import { useEffect, useRef, useState, useCallback } from 'react';
import { ShieldAlert, AlertTriangle, X, Lock, Loader2, CheckCircle2 } from 'lucide-react';
import { usePOSStore } from '../stores/posStore';
import { salesGuardsApi, authApi } from '../services/api';

/* ════════════════════════════════════════════════════════════════
   SALE GUARDS GATE — anti-error check before payment.

   Mounted ONCE in POSPage. Watches the shared `paymentModalOpen` flag
   (set by every checkout entry point: desktop, iPad, F5).

   Design rules:
   - FAIL-OPEN: any error / timeout / offline → never block the till.
   - Read-only: never mutates the sale; only reads the cart.
   - Blocking anomalies (e.g. sale below cost) require a MANAGER PIN to
     proceed. The manager PIN is verified WITHOUT touching the cashier
     session (no token persistence).
   - Warnings are shown as a dismissible banner; payment continues.
   ════════════════════════════════════════════════════════════════ */

interface GuardResult {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  blocking: boolean;
  managerApprovalRequired: boolean;
  message: string;
  productId?: string;
}

const EVAL_TIMEOUT_MS = 2500;
const MANAGER_ROLES = new Set(['manager', 'admin']);

export function SaleGuardsGate() {
  const paymentModalOpen = usePOSStore((s) => s.paymentModalOpen);
  const cartItems = usePOSStore((s) => s.cartItems);
  const employee = usePOSStore((s) => s.employee);
  const setPaymentModalOpen = usePOSStore((s) => s.setPaymentModalOpen);

  const [blocking, setBlocking] = useState<GuardResult[]>([]);
  const [warnings, setWarnings] = useState<GuardResult[]>([]);
  const [gateOpen, setGateOpen] = useState(false);
  const [managerMode, setManagerMode] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifying, setVerifying] = useState(false);

  // Remember the exact cart signature already approved, so re-opening the
  // payment modal for the same cart doesn't re-prompt.
  const approvedSigRef = useRef<string | null>(null);

  const cartSig = cartItems
    .map((i) => `${i.productId}:${i.quantity}:${i.discountMinorUnits}:${i.unitPriceMinorUnits}`)
    .join('|');

  // ── Reset transient UI whenever the modal closes ──
  useEffect(() => {
    if (!paymentModalOpen) {
      setGateOpen(false);
      setManagerMode(false);
      setPin('');
      setPinError('');
      setWarnings([]);
      setBlocking([]);
    }
  }, [paymentModalOpen]);

  // ── Evaluate guards when the payment modal opens for a new cart ──
  useEffect(() => {
    if (!paymentModalOpen || cartItems.length === 0) return;
    if (approvedSigRef.current === cartSig) return; // already approved this cart

    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EVAL_TIMEOUT_MS);

    salesGuardsApi
      .evaluate(
        {
          items: cartItems.map((i) => ({
            productId: i.productId,
            ean: i.ean,
            quantity: i.quantity,
            sellPriceMinorUnits: i.unitPriceMinorUnits,
            discountMinorUnits: i.discountMinorUnits,
          })),
        },
        ctrl.signal,
      )
      .then((res) => {
        if (cancelled) return;
        const results: GuardResult[] = res.data?.results ?? [];
        const blk = results.filter((r) => r.blocking);
        setWarnings(results.filter((r) => !r.blocking && r.severity !== 'info'));
        if (blk.length > 0) {
          setBlocking(blk);
          setGateOpen(true);
        }
      })
      .catch(() => {
        /* FAIL-OPEN — guard unavailable must never freeze the till */
      })
      .finally(() => clearTimeout(timer));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentModalOpen, cartSig]);

  const handleCancel = useCallback(() => {
    setGateOpen(false);
    setPaymentModalOpen(false); // back to cart
  }, [setPaymentModalOpen]);

  const handleManagerSubmit = useCallback(async () => {
    if (!employee?.storeId || pin.length < 4) return;
    setVerifying(true);
    setPinError('');
    try {
      // Verify the PIN belongs to a manager/admin. We do NOT persist the
      // returned tokens — the cashier session stays intact.
      const res = await authApi.loginPin(employee.storeId, pin);
      const role: string | undefined = res.data?.employee?.role;
      if (role && MANAGER_ROLES.has(role)) {
        approvedSigRef.current = cartSig; // remember approval for this cart
        setGateOpen(false);
        setManagerMode(false);
        setPin('');
      } else {
        setPinError('Ce code n’a pas les droits manager.');
        setPin('');
      }
    } catch {
      setPinError('Code incorrect.');
      setPin('');
    } finally {
      setVerifying(false);
    }
  }, [employee?.storeId, pin, cartSig]);

  // ── Warnings banner (non-blocking) ──
  const warningBanner =
    paymentModalOpen && !gateOpen && warnings.length > 0 ? (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] max-w-md w-[92%]">
        <div className="bg-amber-50 border border-amber-300 rounded-xl shadow-lg px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 text-sm text-amber-800">
            {warnings.slice(0, 3).map((w, idx) => (
              <p key={idx}>{w.message}</p>
            ))}
          </div>
          <button onClick={() => setWarnings([])} className="text-amber-500 hover:text-amber-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    ) : null;

  // ── Blocking gate (modal overlay) ──
  const gate =
    gateOpen && blocking.length > 0 ? (
      <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
          <div className="bg-red-50 px-5 py-4 flex items-center gap-2 border-b border-red-100">
            <ShieldAlert className="h-5 w-5 text-red-600" />
            <h2 className="text-lg font-bold text-red-700">Vente bloquée — contrôle requis</h2>
          </div>

          <div className="px-5 py-4 space-y-2">
            {blocking.map((b, idx) => (
              <div key={idx} className="flex items-start gap-2 text-sm text-gray-700">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <span>{b.message}</span>
              </div>
            ))}
          </div>

          {!managerMode ? (
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={handleCancel}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50"
              >
                Annuler la vente
              </button>
              <button
                onClick={() => setManagerMode(true)}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 flex items-center justify-center gap-2"
              >
                <Lock className="h-4 w-4" /> Autoriser (manager)
              </button>
            </div>
          ) : (
            <div className="px-5 pb-5">
              <p className="text-sm text-gray-500 mb-2">Code manager pour autoriser :</p>
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setPinError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleManagerSubmit(); }}
                placeholder="••••"
                maxLength={8}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-red-400"
              />
              {pinError && <p className="text-xs text-red-600 mt-1.5">{pinError}</p>}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => { setManagerMode(false); setPin(''); setPinError(''); }}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50"
                >
                  Retour
                </button>
                <button
                  onClick={handleManagerSubmit}
                  disabled={verifying || pin.length < 4}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Valider
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    ) : null;

  return (
    <>
      {warningBanner}
      {gate}
    </>
  );
}
