import { useState } from 'react';
import { X, Gift, Loader2, Search, CheckCircle2, AlertCircle } from 'lucide-react';
import { returnsApi } from '../../services/api';

/**
 * Bon d'achat — lecture / vérification / application (refonte premium).
 *
 * Gère les bons émis par l'enseigne (avoirs / crédits magasin) :
 *  - lecture du code (douchette ou saisie) ;
 *  - vérification du solde CÔTÉ SERVEUR (returnsApi.lookupCreditNote —
 *    source de vérité unique, le serveur verrouille l'avoir à la vente) ;
 *  - application sur le ticket comme moyen de paiement `store_credit`
 *    (min(solde, reste à payer)), même chemin que le paiement existant ;
 *  - état du bon affiché (type, statut, solde) — aucune donnée inventée.
 *
 * L'historique d'utilisation détaillé vit côté backoffice (journal serveur) ;
 * la caisse affiche l'état réel renvoyé par le serveur.
 */

interface LookupResult {
  code: string;
  type: string;
  status: string;
  remainingMinorUnits: number;
  spendable: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  redeemed: 'Utilisé',
  refunded: 'Remboursé',
  expired: 'Expiré',
  cancelled: 'Annulé',
};

export function BonAchatModal({
  amountDueMinor,
  onApply,
  onClose,
}: {
  /** Reste à payer du ticket courant (0 = panier vide → consultation seule). */
  amountDueMinor: number;
  onApply: (code: string, amountMinorUnits: number) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const eur = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €';

  const lookup = async () => {
    const c = code.trim().toUpperCase();
    if (!c) { setErr('Scannez ou saisissez un code.'); return; }
    setChecking(true);
    setErr(null);
    setResult(null);
    try {
      const res = await returnsApi.lookupCreditNote(c);
      setResult(res.data as LookupResult);
    } catch (e: any) {
      setErr(e?.response?.status === 404 ? 'Bon introuvable.' : (e?.response?.data?.message || 'Erreur de vérification.'));
    } finally {
      setChecking(false);
    }
  };

  const applicable = result && result.spendable ? Math.min(result.remainingMinorUnits, amountDueMinor) : 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-3xl shadow-elevated p-7 space-y-5 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        {/* Titre */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-pos-text flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-pos-accent/10 flex items-center justify-center">
              <Gift size={18} className="text-pos-accent" />
            </span>
            Bon d'achat
          </h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-pos-subtle transition-colors"><X size={18} className="text-pos-muted" /></button>
        </div>

        {/* Lecture / recherche du code */}
        <div className="flex gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); if (err) setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }}
            placeholder="Scanner ou saisir le code (ex : AV-XXXXXXXXXX)"
            autoFocus
            className="flex-1 px-4 py-3 rounded-xl border border-pos-border text-sm font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-pos-accent/20"
          />
          <button
            onClick={lookup}
            disabled={checking || !code.trim()}
            className="px-4 rounded-xl border border-pos-border text-pos-muted hover:bg-pos-subtle transition-colors disabled:opacity-40 flex items-center justify-center"
            title="Vérifier le solde"
          >
            {checking ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          </button>
        </div>

        {/* Résultat de vérification — état réel serveur */}
        {result && (
          <div className={`rounded-2xl border p-4 space-y-2.5 ${result.spendable ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-semibold text-pos-text">{result.code}</span>
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${result.spendable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {result.spendable ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {STATUS_LABELS[result.status] ?? result.status}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-pos-muted">Solde disponible</span>
              <span className="text-2xl font-black tabular-nums text-pos-text">{eur(result.remainingMinorUnits)}</span>
            </div>
            {amountDueMinor > 0 && result.spendable && (
              <div className="flex items-center justify-between text-sm border-t border-black/5 pt-2.5">
                <span className="text-pos-muted">Appliqué sur ce ticket</span>
                <span className="font-bold tabular-nums text-emerald-700">-{eur(applicable)}</span>
              </div>
            )}
            {!result.spendable && (
              <p className="text-xs text-amber-700">Ce bon n'est pas utilisable (déjà consommé, expiré ou solde nul).</p>
            )}
            {amountDueMinor <= 0 && result.spendable && (
              <p className="text-xs text-pos-muted">Panier vide — consultation du solde uniquement.</p>
            )}
          </div>
        )}

        {err && <p className="text-xs font-medium text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

        {/* Actions */}
        <div className="flex gap-2.5 pt-1">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-pos-border text-sm font-semibold text-pos-muted hover:bg-pos-subtle transition-colors">Fermer</button>
          <button
            onClick={() => result && onApply(result.code, applicable)}
            disabled={!result || !result.spendable || applicable <= 0}
            className="flex-1 py-3 rounded-xl bg-pos-accent hover:bg-pos-accent-deep text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Gift size={15} /> Utiliser sur ce ticket
          </button>
        </div>
      </div>
    </div>
  );
}
