/**
 * Bloc 4 — Mode attract : campagnes + playlists + résolveur écran client.
 *
 * Couvre : CRUD campagne, playlist ordonnée, autorisation national (admin only),
 * isolation multi-magasin, et surtout le RÉSOLVEUR (fenêtre de dates, is_active,
 * ciblage caisse, priorité magasin>national, campagne sans média ignorée).
 */
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createPgMemDataSource } from './helpers/pgmem';
import { AttractCampaignEntity } from '../src/database/entities/attract-campaign.entity';
import { AttractMediaEntity } from '../src/database/entities/attract-media.entity';
import { AttractService } from '../src/modules/attract/attract.service';

describe('Bloc 4 — attract campaigns', () => {
  let ds: DataSource;
  let svc: AttractService;
  const STORE = uuidv4();
  const OTHER_STORE = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    ds = dataSource.isInitialized ? dataSource : await dataSource.initialize();
    svc = new AttractService(
      ds.getRepository(AttractCampaignEntity),
      ds.getRepository(AttractMediaEntity),
      ds,
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  // Isolation : chaque test repart d'un état vierge (les campagnes NATIONALES
  // s'appliquent à tous les magasins — sinon elles pollueraient les tests suivants).
  beforeEach(async () => {
    await ds.getRepository(AttractMediaEntity).createQueryBuilder().delete().execute();
    await ds.getRepository(AttractCampaignEntity).createQueryBuilder().delete().execute();
  });

  const vid = (url: string) => ({ type: 'video' as const, url });

  it('create (magasin) + playlist ordonnée ; list expose mediaCount ; get rend les médias ordonnés', async () => {
    const c = await svc.create(STORE, 'manager', {
      name: 'Promo Été',
      media: [vid('a.mp4'), vid('b.mp4'), { type: 'image', url: 'c.png', durationSeconds: 5 }],
    });
    expect(c.storeId).toBe(STORE);
    const got = await svc.get(c.id, STORE);
    expect(got.media!.map((m) => m.url)).toEqual(['a.mp4', 'b.mp4', 'c.png']);
    expect(got.media!.map((m) => m.position)).toEqual([0, 1, 2]);

    const list = await svc.list(STORE);
    expect(list.find((x) => x.id === c.id)!.mediaCount).toBe(3);
  });

  it('campagne nationale : refusée à un manager, autorisée à un admin, visible par tous les magasins', async () => {
    await expect(
      svc.create(STORE, 'manager', { name: 'Nat', scope: 'national' }),
    ).rejects.toThrow(/administrateur/i);

    const nat = await svc.create(STORE, 'admin', { name: 'Nat', scope: 'national', media: [vid('nat.mp4')] });
    expect(nat.storeId).toBeNull();
    // visible depuis un autre magasin (les nationales sont partagées)
    const listOther = await svc.list(OTHER_STORE);
    expect(listOther.some((x) => x.id === nat.id)).toBe(true);
  });

  it('résolveur : campagne magasin active avec média → renvoyée', async () => {
    const s = uuidv4();
    const c = await svc.create(s, 'manager', { name: 'S', media: [vid('x.mp4')] });
    const pl = await svc.resolvePlaylist(s, '01');
    expect(pl).not.toBeNull();
    expect(pl!.campaignId).toBe(c.id);
    expect(pl!.media.map((m) => m.url)).toEqual(['x.mp4']);
  });

  it('résolveur : magasin prime sur national (à priorité égale)', async () => {
    const s = uuidv4();
    await svc.create(s, 'admin', { name: 'Nat', scope: 'national', priority: 0, media: [vid('nat.mp4')] });
    const storeC = await svc.create(s, 'manager', { name: 'Store', priority: 0, media: [vid('store.mp4')] });
    const pl = await svc.resolvePlaylist(s, '01');
    expect(pl!.campaignId).toBe(storeC.id);
  });

  it('résolveur : priorité départage deux campagnes magasin', async () => {
    const s = uuidv4();
    await svc.create(s, 'manager', { name: 'Low', priority: 1, media: [vid('low.mp4')] });
    const high = await svc.create(s, 'manager', { name: 'High', priority: 5, media: [vid('high.mp4')] });
    const pl = await svc.resolvePlaylist(s, '01');
    expect(pl!.campaignId).toBe(high.id);
  });

  it('résolveur : fenêtre de dates (future exclue, passée exclue, en cours incluse)', async () => {
    const s = uuidv4();
    const now = new Date('2026-07-10T12:00:00Z');
    await svc.create(s, 'manager', { name: 'Future', startsAt: '2026-07-20T00:00:00Z', media: [vid('f.mp4')] });
    await svc.create(s, 'manager', { name: 'Past', endsAt: '2026-07-01T00:00:00Z', media: [vid('p.mp4')] });
    expect(await svc.resolvePlaylist(s, '01', now)).toBeNull();

    const live = await svc.create(s, 'manager', {
      name: 'Live', startsAt: '2026-07-05T00:00:00Z', endsAt: '2026-07-15T00:00:00Z', media: [vid('live.mp4')],
    });
    expect((await svc.resolvePlaylist(s, '01', now))!.campaignId).toBe(live.id);
  });

  it('résolveur : is_active=false exclut la campagne', async () => {
    const s = uuidv4();
    const c = await svc.create(s, 'manager', { name: 'Off', isActive: false, media: [vid('off.mp4')] });
    expect(await svc.resolvePlaylist(s, '01')).toBeNull();
    await svc.update(c.id, s, 'manager', { isActive: true });
    expect((await svc.resolvePlaylist(s, '01'))!.campaignId).toBe(c.id);
  });

  it('résolveur : ciblage caisse (terminalIds)', async () => {
    const s = uuidv4();
    const c = await svc.create(s, 'manager', { name: 'T2', terminalIds: ['02'], media: [vid('t2.mp4')] });
    expect(await svc.resolvePlaylist(s, '01')).toBeNull(); // caisse 01 non ciblée
    expect((await svc.resolvePlaylist(s, '02'))!.campaignId).toBe(c.id); // caisse 02 ciblée
  });

  it('résolveur : campagne active SANS média est ignorée (on passe à la suivante)', async () => {
    const s = uuidv4();
    await svc.create(s, 'manager', { name: 'Empty', priority: 10 }); // priorité haute mais aucun média
    const withMedia = await svc.create(s, 'manager', { name: 'Full', priority: 1, media: [vid('full.mp4')] });
    expect((await svc.resolvePlaylist(s, '01'))!.campaignId).toBe(withMedia.id);
  });

  it('isolation multi-magasin : la campagne d’un magasin n’est ni listée ni résolue pour un autre', async () => {
    const s1 = uuidv4();
    const s2 = uuidv4();
    const c = await svc.create(s1, 'manager', { name: 'Priv', media: [vid('priv.mp4')] });
    expect((await svc.list(s2)).some((x) => x.id === c.id)).toBe(false);
    expect(await svc.resolvePlaylist(s2, '01')).toBeNull();
    await expect(svc.get(c.id, s2)).rejects.toThrow(/introuvable/i);
  });

  it('setMedia remplace la playlist ; remove supprime la campagne (médias en cascade)', async () => {
    const s = uuidv4();
    const c = await svc.create(s, 'manager', { name: 'Repl', media: [vid('1.mp4'), vid('2.mp4')] });
    await svc.setMedia(c.id, s, 'manager', [vid('only.mp4')]);
    const got = await svc.get(c.id, s);
    expect(got.media!.map((m) => m.url)).toEqual(['only.mp4']);

    await svc.remove(c.id, s, 'manager');
    await expect(svc.get(c.id, s)).rejects.toThrow(/introuvable/i);
    expect(await ds.getRepository(AttractMediaEntity).count({ where: { campaignId: c.id } })).toBe(0);
  });

  it('manager ne peut pas modifier une campagne nationale', async () => {
    const nat = await svc.create(STORE, 'admin', { name: 'NatEdit', scope: 'national' });
    await expect(svc.update(nat.id, STORE, 'manager', { name: 'x' })).rejects.toThrow(/administrateur|autre magasin/i);
    await expect(svc.remove(nat.id, STORE, 'manager')).rejects.toThrow(/administrateur|autre magasin/i);
  });
});
