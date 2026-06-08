import { NotificationService } from './notification.service';
import { MailService } from './mail.service';
import { SmsService } from './sms.service';
import { DeliveryResult } from './messaging.types';

const ok = (provider: string): DeliveryResult => ({ ok: true, skipped: false, provider });

function mailStub(enabled: boolean): MailService {
  return {
    isEnabled: () => enabled,
    send: jest.fn().mockResolvedValue(ok('sendgrid')),
  } as unknown as MailService;
}
function smsStub(enabled: boolean): SmsService {
  return {
    isEnabled: () => enabled,
    send: jest.fn().mockResolvedValue(ok('twilio')),
  } as unknown as SmsService;
}

describe('NotificationService — channel selection & fallback', () => {
  it('skips when no channel is configured', async () => {
    const svc = new NotificationService(mailStub(false), smsStub(false));
    const res = await svc.notify({ email: { to: 'a@b.com', subject: 's', html: 'h' } });
    expect(res.skipped).toBe(true);
  });

  it('uses email when prefer=email and email is enabled', async () => {
    const mail = mailStub(true);
    const sms = smsStub(true);
    const svc = new NotificationService(mail, sms);
    const res = await svc.notify({
      prefer: 'email',
      email: { to: 'a@b.com', subject: 's', html: 'h' },
      sms: { to: '+33', body: 'b' },
    });
    expect(res.provider).toBe('sendgrid');
    expect(mail.send).toHaveBeenCalled();
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('falls back to email when prefer=sms but SMS is disabled', async () => {
    const mail = mailStub(true);
    const sms = smsStub(false);
    const svc = new NotificationService(mail, sms);
    const res = await svc.notify({
      prefer: 'sms',
      email: { to: 'a@b.com', subject: 's', html: 'h' },
      sms: { to: '+33', body: 'b' },
    });
    expect(res.provider).toBe('sendgrid');
    expect(mail.send).toHaveBeenCalled();
  });

  it('uses SMS when prefer=sms and SMS is enabled', async () => {
    const mail = mailStub(true);
    const sms = smsStub(true);
    const svc = new NotificationService(mail, sms);
    const res = await svc.notify({
      prefer: 'sms',
      email: { to: 'a@b.com', subject: 's', html: 'h' },
      sms: { to: '+33', body: 'b' },
    });
    expect(res.provider).toBe('twilio');
    expect(sms.send).toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });
});
