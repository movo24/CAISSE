import { useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { MonitorSmartphone, Clock, ShieldX, RefreshCw } from 'lucide-react';
import { enrollmentApi, posTerminalId, type EnrollmentStatus } from '../services/api';
import { resolveMachineId } from '../services/machineIdentity';

type GateState = 'checking' | 'allowed' | 'waiting';

/**
 * Barrière d'enrôlement (Partie B) — s'intercale APRÈS l'authentification.
 *
 * Comportement :
 *  - déclare l'identité de la machine (idempotent) puis interroge son statut ;
 *  - si le magasin N'EXIGE PAS l'enrôlement → laisse passer (jamais de blocage
 *    d'une caisse d'un magasin non concerné) ;
 *  - si la machine est APPROUVÉE → laisse passer ;
 *  - sinon → écran d'attente (en attente / rejetée / révoquée), avec polling
 *    automatique jusqu'à l'approbation.
 *
 * Fail-open UI : si le statut est injoignable, on laisse passer — le blocage
 * réel de la VENTE reste appliqué côté serveur (403), donc aucune caisse n'est
 * bloquée à tort par une simple erreur réseau du polling.
 */
export function EnrollmentGate() {
  const [state, setState] = useState<GateState>('checking');
  const [status, setStatus] = useState<EnrollmentStatus | null>(null);
  const machineIdRef = useRef<string>('');
  const declaredRef = useRef(false);

  const platform =
    (window as unknown as { posDesktop?: { platform?: string; version?: string } }).posDesktop?.platform;
  const appVersion =
    (window as unknown as { posDesktop?: { platform?: string; version?: string } }).posDesktop?.version;

  const check = async () => {
    try {
      const machineId = machineIdRef.current || (await resolveMachineId());
      machineIdRef.current = machineId;

      // Déclaration d'identité une seule fois par montage (idempotent serveur).
      if (!declaredRef.current) {
        declaredRef.current = true;
        try {
          await enrollmentApi.request({
            machineId,
            terminalLabel: posTerminalId(),
            platform,
            appVersion,
          });
        } catch {
          // Déclaration best-effort — le statut ci-dessous fait foi.
        }
      }

      const res = await enrollmentApi.status(machineId);
      const s = res.data;
      setStatus(s);
      // Laisse passer si le magasin n'exige pas l'enrôlement OU machine approuvée.
      if (!s.enforced || s.enrolled) setState('allowed');
      else setState('waiting');
    } catch {
      // Statut injoignable → fail-open UI (le serveur bloque la vente si besoin).
      setState('allowed');
    }
  };

  // Vérification initiale au montage (une fois).
  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling automatique UNIQUEMENT tant qu'on attend une validation.
  useEffect(() => {
    if (state !== 'waiting') return;
    const interval = setInterval(check, 12000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (state === 'allowed') return <Outlet />;

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F8FA]">
        <RefreshCw className="animate-spin text-indigo-500" />
      </div>
    );
  }

  // Écran d'attente / refus.
  const rejected = status?.status === 'rejected' || status?.status === 'revoked';
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0b12] text-white p-8">
      <div className="max-w-md w-full text-center">
        <div className="flex justify-center mb-6">
          {rejected ? (
            <ShieldX size={56} className="text-red-400" />
          ) : (
            <MonitorSmartphone size={56} className="text-indigo-300" />
          )}
        </div>
        {rejected ? (
          <>
            <h1 className="text-2xl font-black mb-2">Caisse non autorisée</h1>
            <p className="text-white/70 mb-4">
              Cette caisse a été {status?.status === 'revoked' ? 'révoquée' : 'rejetée'} par le back-office.
              Les ventes sont bloquées.
            </p>
            {status?.decisionReason && (
              <p className="text-sm text-white/50 mb-6">Motif : {status.decisionReason}</p>
            )}
          </>
        ) : (
          <>
            <h1 className="text-2xl font-black mb-2">En attente de validation</h1>
            <p className="text-white/70 mb-6">
              Cette caisse s’est déclarée auprès du back-office. Un responsable doit l’approuver
              avant de pouvoir encaisser. La page se débloque automatiquement une fois validée.
            </p>
          </>
        )}
        <div className="rounded-xl bg-white/5 p-4 text-left text-sm space-y-1 mb-6">
          <div className="flex justify-between"><span className="text-white/50">Terminal</span><span className="font-semibold">{posTerminalId()}</span></div>
          <div className="flex justify-between"><span className="text-white/50">Machine</span><span className="font-mono text-xs">{machineIdRef.current || '—'}</span></div>
          <div className="flex justify-between"><span className="text-white/50">Statut</span><span className="font-semibold">{status?.status ?? '—'}</span></div>
        </div>
        <button
          onClick={check}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 font-semibold"
        >
          <Clock size={16} /> Vérifier maintenant
        </button>
      </div>
    </div>
  );
}

export default EnrollmentGate;
