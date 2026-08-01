import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AiLearningService } from './ai-learning.service';
import { AiRecommendationLogEntity } from '../../database/entities/ai-recommendation-log.entity';

// PAQUET 265 — AI recommendation learning loop. DI-mocked. Locks the write
// tracking (display/click/add-to-cart/conversion) and the read aggregation
// (performance counts + revenue). Scoring thresholds live in reco-scoring.spec.

describe('AiLearningService', () => {
  let service: AiLearningService;
  let logRepo: { save: jest.Mock; update: jest.Mock; find: jest.Mock };

  beforeEach(async () => {
    logRepo = {
      save: jest.fn((x) => Promise.resolve({ id: 'log-1', ...x })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiLearningService,
        { provide: getRepositoryToken(AiRecommendationLogEntity), useValue: logRepo },
      ],
    }).compile();
    service = module.get(AiLearningService);
  });

  it('logDisplay persists a displayed reco with zeroed engagement + returns its id', async () => {
    const id = await service.logDisplay({
      storeId: 's1', triggerProductId: 't', triggerProductName: 'T',
      suggestedProductId: 'p', suggestedProductName: 'P',
      confidence: 0.8, estimatedCashImpact: 100, marginPercent: 30,
    });
    expect(id).toBe('log-1');
    expect(logRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      storeId: 's1', displayed: true, clicked: false, converted: false, employeeId: null,
    }));
  });

  it('logClick / logAddToCart / logConversion patch the right flags', async () => {
    await service.logClick('log-1');
    expect(logRepo.update).toHaveBeenCalledWith('log-1', { clicked: true });

    await service.logAddToCart('log-1');
    expect(logRepo.update).toHaveBeenCalledWith('log-1', { addedToCart: true });

    await service.logConversion('log-1', 'sale-9', 500, 150);
    expect(logRepo.update).toHaveBeenCalledWith('log-1', expect.objectContaining({
      converted: true, saleId: 'sale-9', revenueGenerated: 500, marginGenerated: 150,
    }));
  });

  it('getProductPerformance aggregates displays/clicks/conversions and revenue', async () => {
    logRepo.find.mockResolvedValue([
      { displayed: true, clicked: true, converted: true, revenueGenerated: 500, marginGenerated: 150, suggestedProductName: 'P' },
      { displayed: true, clicked: false, converted: false, revenueGenerated: 0, marginGenerated: 0, suggestedProductName: 'P' },
    ]);
    const perf = await service.getProductPerformance('p', 's1');
    expect(perf.totalDisplayed).toBe(2);
    expect(perf.totalClicked).toBe(1);
    expect(perf.totalConverted).toBe(1);
    expect(perf.totalRevenueGenerated).toBe(500);
    expect(perf.ctr).toBeCloseTo(0.5);
  });

  it('isBlacklisted is false when there is no history (fail-open on no data)', async () => {
    logRepo.find.mockResolvedValue([]);
    await expect(service.isBlacklisted('p', 's1')).resolves.toBe(false);
  });
});
