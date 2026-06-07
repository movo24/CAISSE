import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

function cfg(map: Record<string, string>): ConfigService {
  return {
    get: (key: string, def?: string) => (key in map ? map[key] : def),
  } as unknown as ConfigService;
}

describe('MailService — provider selection & graceful degradation', () => {
  afterEach(() => {
    (global.fetch as any) = undefined;
  });

  it('is disabled (no-op) when nothing is configured', async () => {
    const svc = new MailService(cfg({}));
    expect(svc.isEnabled()).toBe(false);
    const res = await svc.send({ to: 'a@b.com', subject: 'Hi', html: '<p>x</p>' });
    expect(res).toEqual({ ok: false, skipped: true, provider: 'none' });
  });

  it('auto-detects sendgrid from SENDGRID_API_KEY and sends via REST', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
    const svc = new MailService(cfg({ SENDGRID_API_KEY: 'SG.x', MAIL_FROM: 'from@x.com' }));
    expect(svc.isEnabled()).toBe(true);
    const res = await svc.send({ to: 'c@d.com', subject: 'Reçu', html: '<b>ok</b>' });
    expect(res.ok).toBe(true);
    expect(res.provider).toBe('sendgrid');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.sendgrid.com/v3/mail/send',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reports a non-skipped failure when the provider errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' }) as any;
    const svc = new MailService(cfg({ MAIL_PROVIDER: 'sendgrid', SENDGRID_API_KEY: 'SG.bad' }));
    const res = await svc.send({ to: 'c@d.com', subject: 'x', html: 'y' });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(false);
    expect(res.error).toContain('401');
  });

  it('explicit MAIL_PROVIDER=none disables even if a key is present', async () => {
    const svc = new MailService(cfg({ MAIL_PROVIDER: 'none', SENDGRID_API_KEY: 'SG.x' }));
    expect(svc.isEnabled()).toBe(false);
  });
});
