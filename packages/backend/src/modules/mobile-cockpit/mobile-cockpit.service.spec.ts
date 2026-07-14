import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { MobileCockpitService } from './mobile-cockpit.service';
import { StockService } from '../stock/stock.service';
import { SaleAnomalyLogEntity } from '../../database/entities/sale-anomaly-log.entity';

// PAQUET 254 — read-only supervision cockpit: aggregates stock alerts + open sale
// anomalies for a store. DI-mocked. Locks the tenant-scoped anomaly query and the
// summary/overall roll-up produced by buildAlertsCockpit.

describe('MobileCockpitService', () => {
  let service: MobileCockpitService;
  let stockService: { getAlerts: jest.Mock };
  let anomalyRepo: { find: jest.Mock };

  beforeEach(async () => {
    stockService = { getAlerts: jest.fn() };
    anomalyRepo = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileCockpitService,
        { provide: StockService, useValue: stockService },
        { provide: getRepositoryToken(SaleAnomalyLogEntity), useValue: anomalyRepo },
      ],
    }).compile();

    service = module.get(MobileCockpitService);
  });

  it('queries only open anomalies for the store, newest first, bounded by limit', async () => {
    stockService.getAlerts.mockResolvedValue({ alert: [], critical: [] });
    anomalyRepo.find.mockResolvedValue([]);
    await service.getAlerts('store-1', 10);
    expect(anomalyRepo.find).toHaveBeenCalledWith({
      where: { storeId: 'store-1', status: 'detected' },
      order: { createdAt: 'DESC' },
      take: 10,
    });
  });

  it('rolls up counts and overall=ok when nothing is wrong', async () => {
    stockService.getAlerts.mockResolvedValue({ alert: [], critical: [] });
    anomalyRepo.find.mockResolvedValue([]);
    const p = await service.getAlerts('store-1');
    expect(p.summary).toEqual({
      stockAlertCount: 0,
      stockCriticalCount: 0,
      anomaliesOpenCount: 0,
      overall: 'ok',
    });
  });

  it('surfaces critical stock as overall=critical with the right counts', async () => {
    stockService.getAlerts.mockResolvedValue({
      alert: [{ id: 'a', name: 'A', ean: '1', stockQuantity: 2 }],
      critical: [{ id: 'c', name: 'C', ean: '2', stockQuantity: 0 }],
    });
    anomalyRepo.find.mockResolvedValue([]);
    const p = await service.getAlerts('store-1');
    expect(p.summary.stockAlertCount).toBe(1);
    expect(p.summary.stockCriticalCount).toBe(1);
    expect(p.summary.overall).toBe('critical');
    expect(p.stock.critical[0]).toMatchObject({ id: 'c', level: 'critical' });
  });

  it('counts open anomalies and escalates overall on a critical anomaly', async () => {
    stockService.getAlerts.mockResolvedValue({ alert: [], critical: [] });
    anomalyRepo.find.mockResolvedValue([
      { id: 'x', code: 'DISCOUNT', severity: 'critical', message: 'm', createdAt: new Date('2026-06-07T10:00:00Z') },
    ]);
    const p = await service.getAlerts('store-1');
    expect(p.summary.anomaliesOpenCount).toBe(1);
    expect(p.summary.overall).toBe('critical');
    expect(p.anomalies[0].createdAt).toBe('2026-06-07T10:00:00.000Z');
  });
});
