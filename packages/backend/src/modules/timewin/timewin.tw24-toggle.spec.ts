import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TimewinService } from './timewin.service';
import { TimewinEventEntity } from '../../database/entities/timewin-event.entity';
import { StoreEntity } from '../../database/entities/store.entity';

/**
 * Partie C — toggle TW24 par magasin.
 *
 * pushEvent ne remonte un événement QUE si le magasin a `tw24Enabled = true`.
 * Magasin désactivé → skip silencieux (aucune insertion d'outbox, aucun appel
 * réseau). Repo magasin absent (tests hérités) → gate inerte, comportement
 * d'origine préservé.
 */
describe('TimewinService — toggle TW24 par magasin (Partie C)', () => {
  const STORE = 'store-1';

  async function build(opts: { withStoreRepo: boolean; enabled?: boolean }): Promise<{
    service: TimewinService;
    fetchSpy: jest.SpyInstance;
    eventRepo: any;
  }> {
    const eventRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue(undefined),
      increment: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const providers: any[] = [
      TimewinService,
      { provide: ConfigService, useValue: { get: (_k: string, d?: any) => d } },
      { provide: getRepositoryToken(TimewinEventEntity), useValue: eventRepo },
    ];
    if (opts.withStoreRepo) {
      providers.push({
        provide: getRepositoryToken(StoreEntity),
        useValue: { findOne: jest.fn().mockResolvedValue({ id: STORE, tw24Enabled: opts.enabled ?? false }) },
      });
    }
    const module: TestingModule = await Test.createTestingModule({ providers }).compile();
    const service = module.get(TimewinService);
    // Neutralise l'appel réseau réel : on observe s'il est atteint.
    const fetchSpy = jest
      .spyOn(service as any, 'fetchWithPosSecret')
      .mockResolvedValue({ received: true, eventId: 'evt-1' });
    return { service, fetchSpy, eventRepo };
  }

  it('magasin TW24 activé → l’événement est remonté (appel réseau atteint)', async () => {
    const { service, fetchSpy } = await build({ withStoreRepo: true, enabled: true });
    const r = await service.pushEvent(STORE, 'sale.completed', 'emp', { x: 1 }, 'idem-1');
    expect(r.received).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('magasin TW24 désactivé → skip silencieux (aucun appel réseau ni outbox)', async () => {
    const { service, fetchSpy, eventRepo } = await build({ withStoreRepo: true, enabled: false });
    const r = await service.pushEvent(STORE, 'sale.completed', 'emp', { x: 1 }, 'idem-2');
    expect(r).toEqual({ received: false, eventId: '', skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(eventRepo.insert).not.toHaveBeenCalled();
  });

  it('repo magasin absent (tests hérités) → gate inerte, push conservé', async () => {
    const { service, fetchSpy } = await build({ withStoreRepo: false });
    const r = await service.pushEvent(STORE, 'sale.completed', 'emp', { x: 1 }, 'idem-3');
    expect(r.received).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
