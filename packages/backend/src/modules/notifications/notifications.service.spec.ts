import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationsService } from './notifications.service';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { SaleEntity } from '../../database/entities/sale.entity';
import { ProductEntity } from '../../database/entities/product.entity';

// PAQUET 263 — QR reminder message builder. DI-mocked. Locks tenant-scoped
// customer lookup, the not-found guard, and the first-purchase vs loyalty-points
// message branches. (getNotificationSummary aggregation uses query builders and
// is exercised via the reminders/stock helpers + integration coverage.)

describe('NotificationsService — generateQrReminderMessage', () => {
  let service: NotificationsService;
  let customersRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    customersRepo = { findOne: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(CustomerEntity), useValue: customersRepo },
        { provide: getRepositoryToken(SaleEntity), useValue: {} },
        { provide: getRepositoryToken(ProductEntity), useValue: {} },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('is tenant-scoped and throws when the customer is not in the store', async () => {
    customersRepo.findOne.mockResolvedValue(null);
    await expect(service.generateQrReminderMessage('c1', 's1')).rejects.toThrow(/not found in store/);
    expect(customersRepo.findOne).toHaveBeenCalledWith({ where: { id: 'c1', storeId: 's1' } });
  });

  it('builds a first-purchase (-5%) message when isFirstPurchase is true', async () => {
    customersRepo.findOne.mockResolvedValue({
      firstName: 'Alice', lastName: 'D', isFirstPurchase: true, qrCode: 'QR-1', loyaltyPoints: 0,
    });
    const res = await service.generateQrReminderMessage('c1', 's1');
    expect(res.qrCode).toBe('QR-1');
    expect(res.message).toContain('Alice');
    expect(res.message).toContain('-5%');
  });

  it('builds a loyalty-points message when not a first purchase', async () => {
    customersRepo.findOne.mockResolvedValue({
      firstName: 'Bob', lastName: 'M', isFirstPurchase: false, qrCode: 'QR-2', loyaltyPoints: 120,
    });
    const res = await service.generateQrReminderMessage('c1', 's1');
    expect(res.qrCode).toBe('QR-2');
    expect(res.message).toContain('120 points');
  });
});
