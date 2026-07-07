import { useState, useCallback, useEffect, useRef } from 'react';
import { Lock, Delete, UserCircle, Loader2 } from 'lucide-react';
import { usePOSStore } from '../stores/posStore';
import { authApi } from '../services/api';

/**
 * Verrou caisse — une caisse appartient à un caissier pendant une session.
 *
 * S'affiche quand :
 *  - aucun employé n'est connecté ;
 *  - après inactivité (verrouillage, quel que soit le panier) ;
 *  - sur demande explicite (bouton « Changer de caissier »).
 *
 * À la saisie du PIN :
 *  - même employé → SESSION_UNLOCKED, on continue ;
 *  - employé DIFFÉRENT → changement de caissier EXPLICITE (EMPLOYEE_SWITCHED) :
 *    la session précédente est fermée, une nouvelle ouverte. Jamais de switch
 *    silencieux sous le nom du précédent.
 */

const INACTIVITY_LOCK_MINUTES = 3; // V1 : 3–5 min recommandé
const INACTIVITY_TIMEOUT_MS = INACTIVITY_LOCK_MINUTES * 60_000;

interface Props {
  /** Appelé après vérification. Reçoit le nom de l'employé validé. */
  onVerified: (employeeName: string) => void;
}

export function EmployeePinGate({ onVerified }: Props) {
  const employee = usePOSStore((s) => s.employee);
  const lockRequested = usePOSStore((s) => s.lockRequested);
  const requestLock = usePOSStore((s) => s.requestLock);
  const switchEmployee = usePOSStore((s) => s.switchEmployee);
  const logScoreEvent = usePOSStore((s) => s.logScoreEvent);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const lockedRef = useRef(false);
  lockedRef.current = locked;

  const doLock = useCallback(() => {
    if (lockedRef.current) return;
    setLocked(true);
    setPin('');
    logScoreEvent('SESSION_LOCKED', 'Verrouillage après inactivité');
  }, [logScoreEvent]);

  // Verrouillage après inactivité (quel que soit le panier — mission §3.2).
  useEffect(() => {
    function trackActivity() { lastActivityRef.current = Date.now(); }
    window.addEventListener('touchstart', trackActivity, { passive: true });
    window.addEventListener('click', trackActivity);
    window.addEventListener('keydown', trackActivity);

    const interval = setInterval(() => {
      if (!lockedRef.current && employee && Date.now() - lastActivityRef.current > INACTIVITY_TIMEOUT_MS) {
        doLock();
      }
    }, 10_000);

    return () => {
      window.removeEventListener('touchstart', trackActivity);
      window.removeEventListener('click', trackActivity);
      window.removeEventListener('keydown', trackActivity);
      clearInterval(interval);
    };
  }, [employee, doLock]);

  // Demande explicite de verrouillage (bouton « Changer de caissier »).
  useEffect(() => {
    if (lockRequested && !locked) {
      setLocked(true);
      setPin('');
      logScoreEvent('SESSION_LOCKED', 'Changement de caissier demandé');
    }
  }, [lockRequested, locked, logScoreEvent]);

  const shouldShow = locked || !employee;

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
      const res = await authApi.loginPin(employee.storeId, pin);
      const verified = res.data?.employee;
      const token = res.data?.accessToken;
      if (!verified || !token) {
        setError('PIN invalide');
        setPin('');
        setVerifying(false);
        return;
      }

      const sameEmployee = verified.id === employee.id;
      if (sameEmployee) {
        logScoreEvent('SESSION_UNLOCKED', 'Déverrouillage par le titulaire');
      } else {
        // Changement de caissier EXPLICITE — ferme l'ancienne session, ouvre la
        // nouvelle, journalise EMPLOYEE_SWITCHED (jamais de switch silencieux).
        await switchEmployee(
          { id: verified.id, firstName: verified.firstName, lastName: verified.lastName, role: verified.role, storeId: verified.storeId },
          token,
        );
      }

      requestLock(false);
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
  }, [pin, employee, onVerified, switchEmployee, logScoreEvent, requestLock]);

  if (!shouldShow) return <></>;

  const ownerName = employee ? `${employee.firstName} ${employee.lastName}` : '';

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-white rounded-3xl p-8 w-full max-w-xs shadow-2xl">
        <div className="text-center mb-6">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 ${locked ? 'bg-amber-50' : 'bg-indigo-50'}`}>
            {locked ? <Lock size={26} className="text-amber-600" /> : <UserCircle size={28} className="text-indigo-600" />}
          </div>
          {locked ? (
            <>
              <h2 className="text-lg font-bold text-gray-900">Caisse verrouillée</h2>
              <p className="text-xs text-gray-500 mt-1">Session de : <span className="font-semibold text-gray-700">{ownerName}</span></p>
              <p className="text-xs text-gray-500">Code employé requis pour continuer</p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold text-gray-900">Code employé</h2>
              <p className="text-xs text-gray-500 mt-1">Saisissez votre PIN pour commencer</p>
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 mb-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={`pin-dot-${i}`}
              className={`w-3 h-3 rounded-full transition-all ${pin.length > i ? 'bg-indigo-600 scale-110' : 'bg-gray-200'}`} />
          ))}
        </div>

        {error && <p className="text-center text-xs text-red-500 font-medium mb-3">{error}</p>}

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
