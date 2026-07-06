import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ReportsService } from './reports.service';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ZReportEntity } from '../../database/entities/z-report.entity';
import { StoreEntity } from '../../database/entities/store.entity';

describe('ReportsService — getStoreKpi', () => {
  let service: ReportsService;
  let raw: any;

  const build = async () => {
    const qb: any = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(raw),
    };
    const saleRepo = { createQueryBuilder: jest.fn(() => qb) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(SaleEntity), useValue: saleRepo },
        { provide: getRepositoryToken(ZReportEntity), useValue: {} },
        { provide: getRepositoryToken(StoreEntity), useValue: {} },
      ],
    }).compile();
    service = module.get(ReportsService);
  };

  it('computes the average basket from revenue / transactions', async () => {
    raw = { transactionCount: '4', totalRevenueMinorUnits: '4000', discountTotalMinorUnits: '200' };
    await build();
    const kpi = await service.getStoreKpi('s1', '2026-06-07');
    expect(kpi.transactionCount).toBe(4);
    expect(kpi.totalRevenueMinorUnits).toBe(4000);
    expect(kpi.discountTotalMinorUnits).toBe(200);
    expect(kpi.averageBasketMinorUnits).toBe(1000); // 4000 / 4
  });

  it('returns a zero KPI (no division by zero) when there are no sales', async () => {
    raw = { transactionCount: '0', totalRevenueMinorUnits: '0', discountTotalMinorUnits: '0' };
    await build();
    const kpi = await service.getStoreKpi('s1', '2026-06-07');
    expect(kpi.transactionCount).toBe(0);
    expect(kpi.averageBasketMinorUnits).toBe(0);
  });
});
