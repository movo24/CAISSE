import { useState, useEffect, useCallback } from 'react';
import {
  MonitorPlay, Plus, X, Loader2, Trash2, Pencil, ChevronUp, ChevronDown,
  Film, Globe, Store as StoreIcon, Power,
} from 'lucide-react';
import { attractApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import {
  EMPTY_CAMPAIGN_FORM,
  validateCampaignForm,
  buildCampaignPayload,
  isoToLocal,
  type CampaignFormState,
  type MediaFormItem,
} from './campaignForm';

interface MediaRow {
  type: 'video' | 'image';
  url: string;
  durationSeconds: number | null;
  position: number;
}
interface Campaign {
  id: string;
  storeId: string | null;
  name: string;
  isActive: boolean;
  loop: boolean;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  terminalIds: string[] | null;
  mediaCount?: number;
  media?: MediaRow[];
}

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

const dateWindow = (c: Campaign) => {
  if (!c.startsAt && !c.endsAt) return 'Toujours';
  return `${fmtDate(c.startsAt)} → ${fmtDate(c.endsAt)}`;
};

export function CampaignsPage() {
  const employee = useAuthStore((s) => s.employee);
  const isAdmin = employee?.role === 'admin';

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<CampaignFormState>(EMPTY_CAMPAIGN_FORM);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await attractApi.list();
      setCampaigns(res.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Impossible de charger les campagnes (le backend attract est-il déployé ?).");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_CAMPAIGN_FORM);
    setFormOpen(true);
    setError(null);
  };

  const openEdit = async (c: Campaign) => {
    setError(null);
    try {
      const res = await attractApi.get(c.id);
      const full: Campaign = res.data;
      const media: MediaFormItem[] = (full.media || []).map((m) => ({
        type: m.type,
        url: m.url,
        durationSeconds: m.durationSeconds != null ? String(m.durationSeconds) : '',
      }));
      setForm({
        name: full.name,
        scope: full.storeId === null ? 'national' : 'store',
        isActive: full.isActive,
        loop: full.loop,
        startsAt: isoToLocal(full.startsAt),
        endsAt: isoToLocal(full.endsAt),
        priority: String(full.priority ?? 0),
        terminalIdsCsv: (full.terminalIds || []).join(', '),
        media,
      });
      setEditingId(c.id);
      setFormOpen(true);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur au chargement de la campagne.');
    }
  };

  const submit = async () => {
    const err = validateCampaignForm(form, isAdmin);
    if (err) {
      setError(err);
      return;
    }
    const payload = buildCampaignPayload(form);
    setSubmitting(true);
    setError(null);
    try {
      if (editingId) {
        // Champs de campagne (le scope n'est pas modifiable après création côté UI).
        await attractApi.update(editingId, {
          name: payload.name,
          isActive: payload.isActive,
          loop: payload.loop,
          startsAt: payload.startsAt,
          endsAt: payload.endsAt,
          priority: payload.priority,
          terminalIds: payload.terminalIds,
        });
        // Playlist : remplacement ordonné.
        await attractApi.setMedia(editingId, payload.media);
        flashSuccess(`Campagne « ${payload.name} » mise à jour`);
      } else {
        await attractApi.create(payload);
        flashSuccess(`Campagne « ${payload.name} » créée`);
      }
      setFormOpen(false);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur à l’enregistrement.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (c: Campaign) => {
    setBusyId(c.id);
    setError(null);
    try {
      await attractApi.update(c.id, { isActive: !c.isActive });
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (c: Campaign) => {
    if (!window.confirm(`Supprimer la campagne « ${c.name} » et sa playlist ?`)) return;
    setBusyId(c.id);
    setError(null);
    try {
      await attractApi.remove(c.id);
      flashSuccess(`Campagne « ${c.name} » supprimée`);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur.');
    } finally {
      setBusyId(null);
    }
  };

  // ── Playlist editor helpers ──
  const setMediaField = (idx: number, patch: Partial<MediaFormItem>) =>
    setForm((f) => ({ ...f, media: f.media.map((m, i) => (i === idx ? { ...m, ...patch } : m)) }));
  const addMedia = () =>
    setForm((f) => ({ ...f, media: [...f.media, { type: 'video', url: '', durationSeconds: '' }] }));
  const removeMedia = (idx: number) =>
    setForm((f) => ({ ...f, media: f.media.filter((_, i) => i !== idx) }));
  const moveMedia = (idx: number, dir: -1 | 1) =>
    setForm((f) => {
      const j = idx + dir;
      if (j < 0 || j >= f.media.length) return f;
      const media = [...f.media];
      [media[idx], media[j]] = [media[j], media[idx]];
      return { ...f, media };
    });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-bo-text flex items-center gap-2">
          <MonitorPlay size={22} className="text-bo-accent" />
          Campagnes écran client
        </h1>
        <button
          onClick={() => (formOpen ? setFormOpen(false) : openCreate())}
          className="px-3 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 flex items-center gap-1.5"
        >
          {formOpen ? <X size={15} /> : <Plus size={15} />}
          {formOpen ? 'Fermer' : 'Campagne'}
        </button>
      </div>

      <p className="text-sm text-bo-text/60 mb-4">
        Ces playlists s’affichent en mode attract sur l’écran client des caisses. La caisse joue la
        campagne prioritaire (magasin avant national, dans la fenêtre de dates, ciblant la caisse).
      </p>

      {error && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">{error}</div>
      )}
      {success && (
        <div className="mb-4 px-4 py-2.5 bg-green-50 text-green-700 text-sm rounded-lg border border-green-200">{success}</div>
      )}

      {formOpen && (
        <div className="mb-6 p-5 bg-white rounded-xl border border-bo-border shadow-sm">
          <h2 className="text-sm font-bold text-bo-text mb-3">
            {editingId ? 'Modifier la campagne' : 'Nouvelle campagne'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-bo-text/70 sm:col-span-2">
              Nom
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-bo-border rounded-lg text-sm text-bo-text font-normal"
                placeholder="Ex. Promo été 2026"
              />
            </label>

            <label className="text-xs font-semibold text-bo-text/70">
              Portée
              <select
                value={form.scope}
                onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value as 'store' | 'national' }))}
                disabled={!!editingId}
                className="mt-1 w-full px-3 py-2 border border-bo-border rounded-lg text-sm text-bo-text font-normal disabled:bg-gray-50 disabled:text-bo-text/50"
              >
                <option value="store">Magasin</option>
                <option value="national" disabled={!isAdmin}>National{isAdmin ? '' : ' (admin)'}</option>
              </select>
            </label>

            <label className="text-xs font-semibold text-bo-text/70">
              Priorité (plus haut = gagne)
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-bo-border rounded-lg text-sm text-bo-text font-normal"
              />
            </label>

            <label className="text-xs font-semibold text-bo-text/70">
              Début (optionnel)
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-bo-border rounded-lg text-sm text-bo-text font-normal"
              />
            </label>
            <label className="text-xs font-semibold text-bo-text/70">
              Fin (optionnel)
              <input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-bo-border rounded-lg text-sm text-bo-text font-normal"
              />
            </label>

            <label className="text-xs font-semibold text-bo-text/70 sm:col-span-2">
              Caisses ciblées (terminalId, séparés par des virgules ; vide = toutes)
              <input
                value={form.terminalIdsCsv}
                onChange={(e) => setForm((f) => ({ ...f, terminalIdsCsv: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-bo-border rounded-lg text-sm text-bo-text font-normal"
                placeholder="Ex. 01, 02"
              />
            </label>

            <div className="flex items-center gap-4 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-bo-text">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm text-bo-text">
                <input
                  type="checkbox"
                  checked={form.loop}
                  onChange={(e) => setForm((f) => ({ ...f, loop: e.target.checked }))}
                />
                Boucle
              </label>
            </div>
          </div>

          {/* Playlist editor */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-bo-text/70 uppercase tracking-wide">Playlist (ordre = lecture)</span>
              <button
                onClick={addMedia}
                className="text-xs px-2 py-1 bg-bo-accent/10 text-bo-accent rounded-md font-semibold hover:bg-bo-accent/20 flex items-center gap-1"
              >
                <Plus size={13} /> Média
              </button>
            </div>
            {form.media.length === 0 ? (
              <p className="text-xs text-bo-text/50 italic py-2">Aucun média. Ajoutez au moins une vidéo ou image.</p>
            ) : (
              <div className="space-y-2">
                {form.media.map((m, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border border-bo-border">
                    <span className="text-xs font-mono text-bo-text/40 w-5 text-center">{idx + 1}</span>
                    <select
                      value={m.type}
                      onChange={(e) => setMediaField(idx, { type: e.target.value as 'video' | 'image' })}
                      className="px-2 py-1.5 border border-bo-border rounded-md text-xs text-bo-text"
                    >
                      <option value="video">Vidéo</option>
                      <option value="image">Image</option>
                    </select>
                    <input
                      value={m.url}
                      onChange={(e) => setMediaField(idx, { url: e.target.value })}
                      className="flex-1 px-2 py-1.5 border border-bo-border rounded-md text-xs text-bo-text"
                      placeholder="URL https:// (MP4/WebM ou image)"
                    />
                    <input
                      value={m.durationSeconds}
                      onChange={(e) => setMediaField(idx, { durationSeconds: e.target.value })}
                      className="w-16 px-2 py-1.5 border border-bo-border rounded-md text-xs text-bo-text"
                      placeholder="sec"
                      title={m.type === 'image' ? "Durée d'affichage (secondes)" : 'Durée max (secondes, optionnel)'}
                    />
                    <button onClick={() => moveMedia(idx, -1)} disabled={idx === 0} className="p-1 text-bo-text/50 disabled:opacity-30 hover:text-bo-text" title="Monter">
                      <ChevronUp size={15} />
                    </button>
                    <button onClick={() => moveMedia(idx, 1)} disabled={idx === form.media.length - 1} className="p-1 text-bo-text/50 disabled:opacity-30 hover:text-bo-text" title="Descendre">
                      <ChevronDown size={15} />
                    </button>
                    <button onClick={() => removeMedia(idx)} className="p-1 text-red-500 hover:text-red-700" title="Retirer">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm text-bo-text/70 hover:text-bo-text">
              Annuler
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 flex items-center gap-2 disabled:opacity-60"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {editingId ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-bo-text/50">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-16 text-bo-text/50 text-sm">Aucune campagne pour le moment.</div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <div key={c.id} className="p-4 bg-white rounded-xl border border-bo-border flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-bo-text truncate">{c.name}</span>
                  {c.storeId === null ? (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-semibold">
                      <Globe size={11} /> National
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-semibold">
                      <StoreIcon size={11} /> Magasin
                    </span>
                  )}
                  {!c.isActive && (
                    <span className="text-[11px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-semibold">Inactive</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-bo-text/60 flex items-center gap-3 flex-wrap">
                  <span>Priorité {c.priority}</span>
                  <span>·</span>
                  <span>{dateWindow(c)}</span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <Film size={12} /> {c.mediaCount ?? c.media?.length ?? 0} média(s)
                  </span>
                  {c.terminalIds && c.terminalIds.length > 0 && (
                    <>
                      <span>·</span>
                      <span>Caisses {c.terminalIds.join(', ')}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => toggleActive(c)}
                disabled={busyId === c.id}
                title={c.isActive ? 'Désactiver' : 'Activer'}
                className={`p-2 rounded-lg ${c.isActive ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-50'} disabled:opacity-50`}
              >
                {busyId === c.id ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
              </button>
              <button onClick={() => openEdit(c)} className="p-2 text-bo-text/60 hover:text-bo-text rounded-lg hover:bg-gray-50" title="Modifier">
                <Pencil size={16} />
              </button>
              <button onClick={() => remove(c)} disabled={busyId === c.id} className="p-2 text-red-500 hover:text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50" title="Supprimer">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
