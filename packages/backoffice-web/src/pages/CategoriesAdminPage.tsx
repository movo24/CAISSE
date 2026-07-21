import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FolderTree,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Trash2,
  Check,
  X,
  CornerDownRight,
} from 'lucide-react';
import { productsApi } from '../services/api';

interface Category {
  id: string;
  name: string;
  parentId: string | null;
  productCount: number;
}

/** Ordered depth-first flattening of the tree, with a depth for indentation. */
function flattenTree(cats: Category[]): Array<{ cat: Category; depth: number }> {
  const byParent = new Map<string | null, Category[]>();
  for (const c of cats) {
    const key = c.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const out: Array<{ cat: Category; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of byParent.get(parentId) ?? []) {
      out.push({ cat: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Set of a node's own id + all descendant ids (invalid reparent targets). */
function descendantsOf(cats: Category[], id: string): Set<string> {
  const byParent = new Map<string | null, Category[]>();
  for (const c of cats) {
    const key = c.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  const set = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of byParent.get(cur) ?? []) {
      if (!set.has(child.id)) {
        set.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return set;
}

export function CategoriesAdminPage() {
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<string>('');
  const [creating, setCreating] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editParent, setEditParent] = useState<string>('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await productsApi.listCategories();
      setCats(
        (res.data || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          parentId: c.parentId ?? null,
          productCount: c.productCount ?? 0,
        })),
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erreur de chargement des catégories.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flat = useMemo(() => flattenTree(cats), [cats]);
  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 2000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setError('Le nom de la catégorie est obligatoire.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await productsApi.createCategory({ name, parentId: newParent || null });
      setNewName('');
      setNewParent('');
      await load();
      flashSuccess('Catégorie créée.');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Création impossible.');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (c: Category) => {
    setEditId(c.id);
    setEditName(c.name);
    setEditParent(c.parentId ?? '');
    setError(null);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditName('');
    setEditParent('');
  };

  const handleSaveEdit = async (c: Category) => {
    const name = editName.trim();
    if (!name) {
      setError('Le nom de la catégorie ne peut pas être vide.');
      return;
    }
    setSavingId(c.id);
    setError(null);
    try {
      await productsApi.updateCategory(c.id, {
        name,
        parentId: editParent || null,
      });
      cancelEdit();
      await load();
      flashSuccess('Catégorie mise à jour.');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Mise à jour impossible.');
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (c: Category) => {
    if (!window.confirm(`Supprimer la catégorie « ${c.name} » ?`)) return;
    setError(null);
    try {
      await productsApi.deleteCategory(c.id);
      await load();
      flashSuccess('Catégorie supprimée.');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Suppression impossible.');
    }
  };

  /** Reparent options for a node: everything except itself and its descendants. */
  const parentOptions = (excludeId?: string) => {
    const blocked = excludeId ? descendantsOf(cats, excludeId) : new Set<string>();
    return flat
      .filter(({ cat }) => !blocked.has(cat.id))
      .map(({ cat, depth }) => ({
        id: cat.id,
        label: `${'  '.repeat(depth)}${cat.name}`,
      }));
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-bo-text mb-1 flex items-center gap-2">
        <FolderTree size={22} className="text-bo-accent" />
        Catégories
      </h1>
      <p className="text-sm text-bo-muted mb-4">
        Arborescence du catalogue : univers → catégorie → sous-catégorie → segment.
        Une catégorie encore utilisée (produits rattachés ou sous-catégories) ne peut
        pas être supprimée.
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} className="shrink-0" /> {success}
        </div>
      )}

      {/* Création */}
      <form
        onSubmit={handleCreate}
        className="bg-white rounded-xl border border-gray-100 p-4 mb-5 flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
      >
        <div className="flex-1">
          <label className="block text-xs font-semibold text-bo-muted mb-1">Nom</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="ex. Boissons, Maquillage…"
            disabled={creating}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-semibold text-bo-muted mb-1">
            Catégorie parente
          </label>
          <select
            value={newParent}
            onChange={(e) => setNewParent(e.target.value)}
            disabled={creating}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
          >
            <option value="">— Racine (univers) —</option>
            {parentOptions().map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="px-4 py-1.5 bg-bo-accent text-white text-sm font-semibold rounded-lg hover:bg-bo-accent/90 disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Créer
        </button>
      </form>

      {/* Arbre */}
      <div className="bg-white rounded-xl border border-gray-100 p-2">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={28} className="animate-spin text-bo-accent" />
          </div>
        ) : flat.length === 0 ? (
          <div className="text-center py-12 text-bo-muted">
            <FolderTree size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Aucune catégorie. Créez le premier univers ci-dessus.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {flat.map(({ cat, depth }) => (
              <li key={cat.id} className="py-2 px-2">
                {editId === cat.id ? (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                    />
                    <select
                      value={editParent}
                      onChange={(e) => setEditParent(e.target.value)}
                      className="px-2 py-1 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
                    >
                      <option value="">— Racine —</option>
                      {parentOptions(cat.id).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleSaveEdit(cat)}
                        disabled={savingId === cat.id}
                        className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                        title="Enregistrer"
                      >
                        {savingId === cat.id ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Check size={15} />
                        )}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-1.5 rounded-lg bg-gray-50 text-bo-muted hover:bg-gray-100"
                        title="Annuler"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 group">
                    <span style={{ width: depth * 20 }} className="shrink-0" />
                    {depth > 0 && (
                      <CornerDownRight size={14} className="text-gray-300 shrink-0" />
                    )}
                    <FolderTree
                      size={15}
                      className={depth === 0 ? 'text-bo-accent shrink-0' : 'text-bo-muted shrink-0'}
                    />
                    <span className="text-sm text-bo-text font-medium">{cat.name}</span>
                    <span className="text-[11px] font-semibold text-bo-muted bg-gray-50 px-2 py-0.5 rounded-full">
                      {cat.productCount} produit{cat.productCount > 1 ? 's' : ''}
                    </span>
                    <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(cat)}
                        className="p-1.5 rounded-lg text-bo-muted hover:bg-gray-100"
                        title="Renommer / déplacer"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(cat)}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                        title="Supprimer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
