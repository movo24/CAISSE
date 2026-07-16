import { SavedFiltersService } from './saved-filters.service';

/**
 * P-D / M-G — service vues enregistrables : upsert (create puis remplace le même
 * nom), list par (employé, page), remove owner-scopé, rejet du nom vide.
 */
function makeRepo() {
  let rows: any[] = [];
  let seq = 0;
  const match = (r: any, w: any) => Object.entries(w).every(([k, v]) => r[k] === v);
  return {
    _rows: () => rows,
    find: async ({ where, order }: any) => {
      let out = rows.filter((r) => match(r, where));
      if (order?.name) out = [...out].sort((a, b) => a.name.localeCompare(b.name));
      return out;
    },
    findOne: async ({ where }: any) => rows.find((r) => match(r, where)) ?? null,
    create: (data: any) => ({ ...data }),
    save: async (row: any) => {
      if (!row.id) { row = { id: `f${++seq}`, ...row }; rows.push(row); }
      return row;
    },
    delete: async (where: any) => {
      const before = rows.length;
      rows = rows.filter((r) => !match(r, where));
      return { affected: before - rows.length };
    },
  };
}

describe('SavedFiltersService (M-G)', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: SavedFiltersService;
  const E = 'emp-1';

  beforeEach(() => {
    repo = makeRepo();
    service = new SavedFiltersService(repo as any);
  });

  it('crée une vue puis remplace sa config au même nom (upsert)', async () => {
    const a = await service.upsert(E, 'products', 'Vue A', { search: 'coca' });
    const b = await service.upsert(E, 'products', 'Vue A', { search: 'pepsi' });
    expect(b.id).toBe(a.id); // même ligne
    expect(b.config).toEqual({ search: 'pepsi' });
    expect(repo._rows().filter((r) => r.name === 'Vue A')).toHaveLength(1);
  });

  it('liste par employé et page, triée par nom', async () => {
    await service.upsert(E, 'products', 'Zèbre', {});
    await service.upsert(E, 'products', 'Alpha', {});
    await service.upsert(E, 'other', 'Autre', {});
    const list = await service.list(E, 'products');
    expect(list.map((r) => r.name)).toEqual(['Alpha', 'Zèbre']);
  });

  it('rejette un nom vide', async () => {
    await expect(service.upsert(E, 'products', '   ', {})).rejects.toThrow();
  });

  it('supprime une vue (owner-scopé) et rapporte le résultat', async () => {
    const a = await service.upsert(E, 'products', 'Vue A', {});
    expect(await service.remove(E, a.id)).toEqual({ deleted: true });
    expect(await service.remove(E, a.id)).toEqual({ deleted: false }); // déjà supprimée
  });
});
