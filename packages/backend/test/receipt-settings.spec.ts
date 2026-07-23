/**
 * Réglages « Ticket de caisse » (Dashboard → Paramètres → Magasins) —
 * StoresService.getReceiptSettings / updateReceiptSettings.
 *
 * Garanties couvertes :
 *  - patch partiel : seuls les champs fournis ET réellement modifiés sont
 *    écrits ; un patch sans changement n'écrit rien et n'audite rien ;
 *  - CHAQUE modification est auditée avec ancienne/nouvelle valeur
 *    (utilisateur, magasin) ; le logo (data-URL volumineuse) est audité par
 *    empreinte sha256, jamais en valeur brute ;
 *  - configuration indépendante PAR MAGASIN (l'update cible le storeId donné).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StoresService } from '../src/modules/stores/stores.service';
import { StoreEntity } from '../src/database/entities/store.entity';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { UnitEntity } from '../src/database/entities/unit.entity';
import { TimewinService } from '../src/modules/timewin/timewin.service';
import { AuditService } from '../src/modules/audit/audit.service';

describe('Receipt settings (ticket de caisse)', () => {
  let service: StoresService;
  let storeRepo: any;
  let audit: { log: jest.Mock };

  const mockStore: any = {
    id: 'store-1',
    name: 'The Wesley — Test',
    isActive: true,
    websiteUrl: null,
    receiptLogoUrl: null,
    receiptQrEnabled: true,
    receiptQrText: null,
    footerMessage: 'Merci !',
    receiptFinalMessage: null,
    receiptShowRecommendations: false,
    receiptRecommendationTarget: null,
    receiptRecommendationCategoryId: null,
    receiptPublicBaseUrl: null,
  };

  beforeEach(async () => {
    storeRepo = {
      findOne: jest.fn().mockResolvedValue({ ...mockStore }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoresService,
        { provide: getRepositoryToken(StoreEntity), useValue: storeRepo },
        { provide: getRepositoryToken(OrganizationEntity), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(UnitEntity), useValue: { findOne: jest.fn() } },
        { provide: DataSource, useValue: {} },
        { provide: TimewinService, useValue: { pushEvent: jest.fn() } },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(StoresService);
  });

  it('getReceiptSettings : renvoie réglages + identité (pour aperçu et « à compléter »)', async () => {
    const res = await service.getReceiptSettings('store-1');
    expect(res.storeId).toBe('store-1');
    expect(res.settings.receiptQrEnabled).toBe(true);
    expect(res.settings.footerMessage).toBe('Merci !');
    expect(res.identity.name).toBe('The Wesley — Test');
    // Une donnée absente est null — l'admin affiche « information à compléter »,
    // le ticket ne l'imprime pas.
    expect(res.identity.siret).toBeNull();
  });

  it('update : écrit UNIQUEMENT les champs modifiés et audite old/new', async () => {
    await service.updateReceiptSettings(
      'store-1',
      { websiteUrl: 'https://thewesleys.fr', receiptQrText: 'Scannez-moi' } as any,
      'emp-9',
    );
    expect(storeRepo.update).toHaveBeenCalledWith('store-1', {
      websiteUrl: 'https://thewesleys.fr',
      receiptQrText: 'Scannez-moi',
    });
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0];
    expect(entry).toMatchObject({
      storeId: 'store-1',
      employeeId: 'emp-9',
      action: 'receipt_settings_updated',
      entityType: 'store',
      entityId: 'store-1',
    });
    expect(entry.details.changes.websiteUrl).toEqual({ old: null, new: 'https://thewesleys.fr' });
    expect(entry.details.changes.receiptQrText).toEqual({ old: null, new: 'Scannez-moi' });
  });

  it('update sans changement effectif : aucune écriture, aucun audit', async () => {
    await service.updateReceiptSettings('store-1', { footerMessage: 'Merci !' } as any, 'emp-9');
    expect(storeRepo.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('logo : audité par empreinte sha256, JAMAIS en data-URL brute', async () => {
    const logo = 'data:image/png;base64,' + 'A'.repeat(5000);
    await service.updateReceiptSettings('store-1', { receiptLogoUrl: logo } as any, 'emp-9');
    const changes = audit.log.mock.calls[0][0].details.changes;
    expect(String(changes.receiptLogoUrl.new)).toMatch(/^sha256:[0-9a-f]{16} \(\d+ chars\)$/);
    expect(String(changes.receiptLogoUrl.new)).not.toContain('AAAA');
    expect(changes.receiptLogoUrl.old).toBeNull();
  });

  it('configuration par magasin : l’update cible exactement le storeId demandé', async () => {
    await service.updateReceiptSettings('store-1', { receiptQrEnabled: false } as any, 'emp-9');
    expect(storeRepo.findOne).toHaveBeenCalledWith({ where: { id: 'store-1' } });
    expect(storeRepo.update.mock.calls[0][0]).toBe('store-1');
  });
});
