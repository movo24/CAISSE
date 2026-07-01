import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';

import { ReceiptsController } from './receipts.controller';
import { SaleEntity } from '../../database/entities/sale.entity';
import { SaleLineItemEntity } from '../../database/entities/sale-line-item.entity';
import { SalePaymentEntity } from '../../database/entities/sale-payment.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { MailService } from '../../common/messaging/mail.service';

const SALE_ID = '11111111-1111-4111-8111-111111111111';

describe('ReceiptsController — email receipt', () => {
  let controller: ReceiptsController;
  let mail: { send: jest.Mock };

  beforeEach(async () => {
    mail = { send: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReceiptsController],
      providers: [
        {
          provide: getRepositoryToken(SaleEntity),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: SALE_ID, ticketNumber: 'T-000123', storeId: 's1',
              subtotalMinorUnits: 1000, discountTotalMinorUnits: 0, totalMinorUnits: 1000,
              createdAt: new Date('2026-06-07T10:00:00Z'), employeeNameSnapshot: 'Jean',
            }),
          },
        },
        { provide: getRepositoryToken(SaleLineItemEntity), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(SalePaymentEntity), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(StoreEntity), useValue: { findOne: jest.fn().mockResolvedValue({ name: 'Boutique' }) } },
        { provide: MailService, useValue: mail },
      ],
    }).compile();
    controller = module.get(ReceiptsController);
  });

  it('rejects an invalid email address', async () => {
    await expect(controller.emailReceipt(SALE_ID, { email: 'not-an-email' })).rejects.toThrow(BadRequestException);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('returns { sent: true } when the mail provider sends', async () => {
    mail.send.mockResolvedValue({ ok: true, skipped: false, provider: 'sendgrid' });
    const res = await controller.emailReceipt(SALE_ID, { email: 'client@x.com' });
    expect(res).toEqual({ sent: true });
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'client@x.com', subject: expect.stringContaining('T-000123') }),
    );
  });

  it('degrades gracefully to { sent: false, skipped: true } when no provider is configured', async () => {
    mail.send.mockResolvedValue({ ok: false, skipped: true, provider: 'none' });
    const res = await controller.emailReceipt(SALE_ID, { email: 'client@x.com' });
    expect(res).toEqual({ sent: false, skipped: true });
  });
});

// POS-INT-241 — XSS regression lock: a malicious product/store name must be HTML-escaped
// in the public receipt HTML (POS-132 escapeHtml wired in the controller).
describe('ReceiptsController — receipt HTML XSS escaping', () => {
  const XSS = '<script>alert(1)</script>';
  let controller: ReceiptsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReceiptsController],
      providers: [
        {
          provide: getRepositoryToken(SaleEntity),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: SALE_ID, ticketNumber: 'T-000123', storeId: 's1',
              subtotalMinorUnits: 1000, discountTotalMinorUnits: 0, totalMinorUnits: 1000,
              taxRate: 20, createdAt: new Date('2026-06-07T10:00:00Z'), employeeNameSnapshot: 'Jean',
            }),
          },
        },
        {
          provide: getRepositoryToken(SaleLineItemEntity),
          useValue: { find: jest.fn().mockResolvedValue([{ productName: XSS, quantity: 1, unitPriceMinorUnits: 1000, totalMinorUnits: 1000 }]) },
        },
        { provide: getRepositoryToken(SalePaymentEntity), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(StoreEntity), useValue: { findOne: jest.fn().mockResolvedValue({ name: XSS, address: XSS }) } },
        { provide: MailService, useValue: { send: jest.fn() } },
      ],
    }).compile();
    controller = module.get(ReceiptsController);
  });

  it('escapes <script> in item + store names, never emits the raw tag', async () => {
    const html: string = await controller.getReceiptHtml(SALE_ID);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
