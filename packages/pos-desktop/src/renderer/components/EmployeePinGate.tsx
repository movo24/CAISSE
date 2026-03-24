import { useState, useCallback, useEffect, useRef } from 'react';
import { Lock, Delete, UserCircle, Loader2 } from 'lucide-react';
import { usePOSStore } from '../stores/posStore';
import { authApi } from '../services/api';

/**
 * Overlay that requires employee PIN before starting a new ticket.
 * Shows when:
 * - No employee is set on the current session
 * - After inactivity timeout (configurable)
 * - After a completed sale (panier vide)
 *
 * Does NOT show when:
 * - Employee already identified and ticket in progress
 * - Cart has items (employee already validated)
 */

const INACTIVITY_TIMEOUT_MS = 120_000; // 2 minutes

interface Props {
  /** Called when employee is verified. Receives employee name. */
  onVerified: (employeeName: string) => void;
}

export function EmployeePinGate({ onVerified }: Props) {
  const employee = usePOSStore((s) => s.employee);
  const cartItems = usePOSStore((s) => s.cartItems);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const lastActivityRef = useRef(Date.now());

  // Lock after inactivity when cart is empty
  useEffect(() => {
    function trackActivity() {
      lastActivityRef.current = Date.now();
    }
    window.addEventListener('touchstart', trackActivity, { passive: true });
    window.addEventListener('click', trackActivity);
    window.addEventListener('keydown', trackActivity);

    const interval = setInterval(() => {
      if (cartItems.length === 0 && Date.now() - lastActivityRef.current > INACTIVITY_TIMEOUT_MS) {
        setLocked(true);
        setPin('');
      }
    }, 10_000);

    return () => {
      window.removeEventListener('touchstart', trackActivity);
      window.removeEventListener('click', trackActivity);
      window.removeEventListener('keydown', trackActivity);
      clearInterval(interval);
    };
  }, [cartItems.length]);

  // Don't show if employee is active and cart has items (ticket in progress)
  if (!locked && employee && cartItems.length > 0) return null;
  // Don't show if not locked and employee exists (ready for new ticket)
  if (!locked && employee) return null;

  const handleDigit = useCallback((digit: string) => {
    setError('');
    setPin((prev) => (prev.length >= 8 ? prev : prev + digit));
  }, []);

  const handleDelete = useCallback(() => {
    setError('');
    setPin((prev) => prev.slice(0, -1));
  }, []);

  const [verifying, setVerifying] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!employee || pin.length < 4) {
      setError('PIN trop court (min 4 chiffres)');
      return;
    }

    setVerifying(true);
    setError('');

    try {
      // Verify PIN against backend — this checks the real bcrypt hash
      const res = await authApi.loginPin(employee.storeId, pin);
      const verified = res.data?.employee;

      if (!verified) {
        setError('PIN invalide');
        setPin('');
        setVerifying(false);
        return;
      }

      // PIN is valid — use the verified employee name for accountability
      setLocked(false);
      setPin('');
      setError('');
      onVerified(`${verified.firstName} ${verified.lastName}`);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'PIN invalide';
      setError(msg);
      setPin('');
    } finally {
      setVerifying(false);
    }
  }, [pin, employee, onVerified]);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-white rounded-3xl p-8 w-full max-w-xs shadow-2xl">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
            <UserCircle size={28} className="text-indigo-600" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Code employe</h2>
          <p className="text-xs text-gray-500 mt-1">Saisissez votre PIN pour commencer</p>
        </div>

        {/* PIN dots (supports 4-8 digit PINs) */}
        <div className="flex items-center justify-center gap-2 mb-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={`pin-dot-${i}`}
              className={`w-3 h-3 rounded-full transition-all ${
                pin.length > i ? 'bg-indigo-600 scale-110' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-center text-xs text-red-500 font-medium mb-3">{error}</p>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((key) => {
            if (key === '') return <div key="empty" />;
            if (key === 'del') {
              return (
                <button key="del" onClick={handleDelete}
                  className="h-12 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600 active:bg-gray-200">
                  <Delete size={18} />
                </button>
              );
            }
            return (
              <button key={key} onClick={() => handleDigit(key)}
                className="h-12 rounded-xl bg-gray-50 text-gray-900 text-lg font-semibold active:bg-indigo-50 transition-colors">
                {key}
              </button>
            );
          })}
        </div>

        {pin.length >= 4 && (
          <button onClick={handleSubmit} disabled={verifying}
            className="w-full mt-4 py-3 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {verifying ? <><Loader2 size={16} className="animate-spin" /> Vérification...</> : 'Valider'}
          </button>
        )}
      </div>
    </div>
  );
}
