import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CustomersService } from './customers.service';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { NotificationService } from '../../common/messaging/notification.service';

/** M2 — loyalty OTP is delivered via the messaging providers (graceful). */
describe('CustomersService — OTP delivery', () => {
  let service: CustomersService;
  let notify: jest.Mock;

  const build = async (saved: Partial<CustomerEntity>) => {
    notify = jest.fn().mockResolvedValue({ ok: true, skipped: false, provider: 'twilio' });
    const repo = {
      create: (d: any) => d,
      save: jest.fn().mockResolvedValue({ id: 'cust-1234', firstName: 'Jean', ...saved }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: getRepositoryToken(CustomerEntity), useValue: repo },
        { provide: NotificationService, useValue: { notify } },
      ],
    }).compile();
    service = module.get(CustomersService);
  };

  it('sends the OTP via SMS when the customer has a phone', async () => {
    await build({ phone: '+33600000000' });
    const res = await service.create({ firstName: 'Jean', lastName: 'D', phone: '+33600000000', storeId: 's1' });
    expect(notify).toHaveBeenCalledTimes(1);
    const arg = notify.mock.calls[0][0];
    expect(arg.prefer).toBe('sms');
    expect(arg.sms.to).toBe('+33600000000');
    expect(arg.sms.body).toContain(res.otpCode);
  });

  it('does not attempt delivery when the customer has neither phone nor email', async () => {
    await build({});
    await service.create({ firstName: 'Jean', lastName: 'D', storeId: 's1' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('still creates the customer if OTP delivery throws', async () => {
    await build({ email: 'j@x.com' });
    notify.mockRejectedValueOnce(new Error('provider down'));
    const res = await service.create({ firstName: 'Jean', lastName: 'D', email: 'j@x.com', storeId: 's1' });
    expect(res.customer.id).toBe('cust-1234');
  });
});
