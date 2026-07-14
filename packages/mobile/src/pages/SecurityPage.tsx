// ── Sécurité : « Mes appareils et clés d'accès » ─────────────────
// Liste des passkeys du compte (nom, création, dernière utilisation),
// renommage, révocation (journalisée dans l'audit serveur), ajout.
// Aucune donnée biométrique : uniquement des métadonnées publiques.
// ─────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Fingerprint, KeyRound, Loader2, Pencil, ShieldOff } from 'lucide-react';
import { webauthnApi } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useAuthStore } from '../stores/authStore';
import { ErrorBanner, LoadingCards, PageHeader, SyncBadge } from '../components/ui';
import { formatSince } from '../lib/format';
import { isUserCancellation, registerPasskey, suggestDeviceName } from '../lib/webauthn';

export function SecurityPage() {
  const navigate = useNavigate();
  const employee = useAuthStore((s) => s.employee);
  const list = useApi('webauthn-credentials', () => webauthnApi.credentials(), []);
  const creds: any[] = Array.isArray(list.data) ? (list.data as any[]) : [];
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const rename = async (id: string, current: string) => {
    // prompt natif : simple, tactile, sans dépendance.
    const name = window.prompt('Nouveau nom de l’appareil :', current);
    if (!name || !name.trim()) return;
    setBusyId(id);
    setActionError(null);
    try {
      await webauthnApi.rename(id, name.trim());
      list.reload();
    } catch (e: any) {
      setActionError(e?.response?.data?.message ?? 'Renommage impossible.');
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (id: string, name: string) => {
    if (!window.confirm(`Révoquer « ${name} » ? Cette clé ne pourra plus se connecter (action journalisée).`)) return;
    setBusyId(id);
    setActionError(null);
    try {
      await webauthnApi.revoke(id);
      list.reload();
    } catch (e: any) {
      setActionError(e?.response?.data?.message ?? 'Révocation impossible.');
    } finally {
      setBusyId(null);
    }
  };

  const addKey = async () => {
    setAdding(true);
    setActionError(null);
    try {
      await registerPasskey(suggestDeviceName(employee?.firstName));
      list.reload();
    } catch (e: any) {
      if (isUserCancellation(e)) {
        setActionError('Ajout annulé par l’utilisateur.');
      } else {
        setActionError(e?.response?.data?.message ?? e?.message ?? 'Cet appareil ne permet pas d’ajouter une clé d’accès.');
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="pb-4">
      <PageHeader
        title="Sécurité"
        subtitle="Mes appareils et clés d'accès"
        right={
          <button onClick={() => navigate(-1)} aria-label="Retour" className="p-2 rounded-xl active:bg-mobile-subtle">
            <ArrowLeft size={19} className="text-mobile-muted" />
          </button>
        }
      />
      <div className="px-4 pt-3 space-y-3">
        {list.error && <ErrorBanner message={list.error} onRetry={list.reload} />}
        <SyncBadge syncedAt={list.syncedAt} fromCache={list.fromCache} onReload={list.reload} loading={list.loading} />
        {actionError && (
          <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2.5">{actionError}</p>
        )}

        {list.loading && !list.data ? (
          <LoadingCards count={2} />
        ) : (
          <>
            {creds.length === 0 && (
              <div className="bg-mobile-card rounded-2xl shadow-card p-4 text-center">
                <p className="text-sm text-mobile-muted">
                  Aucune clé d’accès enregistrée. Ajoutez-en une pour vous connecter avec
                  Face ID, Touch ID, Windows Hello ou une clé de sécurité.
                </p>
              </div>
            )}
            {creds.length > 0 && (
              <div className="bg-mobile-card rounded-2xl shadow-card divide-y divide-mobile-border/50">
                {creds.map((c) => (
                  <div key={c.id} className={`px-3.5 py-3 flex items-center gap-3 ${c.revokedAt ? 'opacity-55' : ''}`}>
                    <span className="w-9 h-9 rounded-xl bg-mobile-subtle flex items-center justify-center shrink-0">
                      <Fingerprint size={17} className="text-mobile-text" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">
                        {c.deviceName}
                        {c.backedUp ? <span className="ml-1.5 text-[9px] font-bold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">synchronisée</span> : null}
                        {c.revokedAt ? <span className="ml-1.5 text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">révoquée</span> : null}
                      </span>
                      <span className="block text-[11px] text-mobile-muted">
                        Créée {formatSince(c.createdAt)} · Dernière utilisation : {c.lastUsedAt ? formatSince(c.lastUsedAt) : 'jamais'}
                      </span>
                    </span>
                    {!c.revokedAt && (
                      <span className="flex gap-1 shrink-0">
                        <button
                          onClick={() => rename(c.id, c.deviceName)}
                          disabled={busyId === c.id}
                          aria-label={`Renommer ${c.deviceName}`}
                          className="p-2.5 rounded-xl bg-mobile-subtle active:opacity-80"
                        >
                          <Pencil size={15} className="text-mobile-text" />
                        </button>
                        <button
                          onClick={() => revoke(c.id, c.deviceName)}
                          disabled={busyId === c.id}
                          aria-label={`Révoquer ${c.deviceName}`}
                          className="p-2.5 rounded-xl bg-red-50 active:opacity-80"
                        >
                          {busyId === c.id ? <Loader2 size={15} className="animate-spin" /> : <ShieldOff size={15} className="text-red-600" />}
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={addKey}
              disabled={adding}
              className="w-full min-h-[48px] rounded-2xl bg-mobile-text text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {adding ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
              Ajouter une clé d’accès
            </button>

            <p className="text-[11px] text-mobile-muted px-1">
              En cas de perte de tous vos appareils, la connexion centralisée The Wesley
              (email + code d’accès) reste disponible — la biométrie n’est jamais l’unique
              moyen d’accès. Toute révocation est journalisée dans l’audit de sécurité.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
