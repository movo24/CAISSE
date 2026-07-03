import { AlertService } from './alert.service';

/**
 * P365 — AlertService webhook fail-safe (ALERT_WEBHOOK_URL present / absent).
 *
 * AlertService is a singleton whose constructor reads ALERT_WEBHOOK_URL once. To
 * exercise both env states we reset the memoized instance between cases. The
 * contract: firing an alert ALWAYS logs and records history and NEVER throws —
 * whether or not a webhook is configured, and even if the webhook call rejects.
 */
describe('AlertService — webhook fail-safe', () => {
  const savedUrl = process.env.ALERT_WEBHOOK_URL;
  const savedFetch = globalThis.fetch;

  const resetSingleton = () => {
    (AlertService as any)._instance = undefined;
  };

  afterEach(() => {
    resetSingleton();
    if (savedUrl === undefined) delete process.env.ALERT_WEBHOOK_URL;
    else process.env.ALERT_WEBHOOK_URL = savedUrl;
    globalThis.fetch = savedFetch;
  });

  it('without ALERT_WEBHOOK_URL: fire() records history, never throws, never hits the network', () => {
    delete process.env.ALERT_WEBHOOK_URL;
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as any;
    resetSingleton();

    const svc = AlertService.instance;
    expect(() => svc.fire('REDIS_DOWN', 'redis unreachable')).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(svc.getRecent(1)[0]?.event).toBe('REDIS_DOWN');
  });

  it('dedups the same event within the cooldown window', () => {
    delete process.env.ALERT_WEBHOOK_URL;
    resetSingleton();

    const svc = AlertService.instance;
    svc.fire('TIMEWIN_DOWN', 'first');
    svc.fire('TIMEWIN_DOWN', 'second (deduped)');
    const fired = svc.getRecent(10).filter((e) => e.event === 'TIMEWIN_DOWN');
    expect(fired).toHaveLength(1);
  });

  it('with ALERT_WEBHOOK_URL: fire() POSTs to the webhook (fire-and-forget)', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/pos';
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchSpy as any;
    resetSingleton();

    const svc = AlertService.instance;
    svc.fire('CIRCUIT_BREAKER_OPEN', 'breaker open');
    await Promise.resolve(); // let the fire-and-forget .catch settle

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://hooks.example.com/pos');
  });

  it('with ALERT_WEBHOOK_URL: a failing webhook never throws to the caller', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/pos';
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('network down')) as any;
    resetSingleton();

    const svc = AlertService.instance;
    expect(() => svc.fire('LOGIN_BRUTEFORCE', 'burst')).not.toThrow();
    await Promise.resolve();
  });
});
