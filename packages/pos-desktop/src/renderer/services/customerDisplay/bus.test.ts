import { describe, it, expect, vi } from 'vitest';
import { CustomerDisplayBus, validateCustomerDisplayMessage, type CustomerDisplayMessage } from './bus';

describe('validateCustomerDisplayMessage', () => {
  const validSnapshot = {
    type: 'snapshot',
    snapshot: { storeName: 'X', terminalLabel: 'T', items: [], itemCount: 0, subtotalMinorUnits: 0, totalDiscountMinorUnits: 0, totalMinorUnits: 0, customer: null, at: '' },
  };

  it('accepts well-formed messages of every type', () => {
    expect(validateCustomerDisplayMessage(validSnapshot)).not.toBeNull();
    expect(validateCustomerDisplayMessage({ type: 'payment', phase: 'pending', amountMinorUnits: 100, changeMinorUnits: 0, method: 'card' })).not.toBeNull();
    expect(validateCustomerDisplayMessage({ type: 'config', settings: {} })).not.toBeNull();
    expect(validateCustomerDisplayMessage({ type: 'command', command: 'identify' })).not.toBeNull();
    expect(validateCustomerDisplayMessage({ type: 'hello', at: 'now', resolution: '1x1' })).not.toBeNull();
  });

  it('rejects non-objects and missing type', () => {
    expect(validateCustomerDisplayMessage(null)).toBeNull();
    expect(validateCustomerDisplayMessage(42)).toBeNull();
    expect(validateCustomerDisplayMessage('snapshot')).toBeNull();
    expect(validateCustomerDisplayMessage({})).toBeNull();
    expect(validateCustomerDisplayMessage({ type: 'unknown' })).toBeNull();
  });

  it('rejects a snapshot with a non-array items or non-finite totals', () => {
    expect(validateCustomerDisplayMessage({ type: 'snapshot', snapshot: { items: 'x', itemCount: 0, totalMinorUnits: 0 } })).toBeNull();
    expect(validateCustomerDisplayMessage({ type: 'snapshot', snapshot: { items: [], itemCount: NaN, totalMinorUnits: 0 } })).toBeNull();
    expect(validateCustomerDisplayMessage({ type: 'snapshot' })).toBeNull();
  });

  it('rejects a payment with an unknown phase or bad amounts', () => {
    expect(validateCustomerDisplayMessage({ type: 'payment', phase: 'hacked', amountMinorUnits: 1, changeMinorUnits: 0 })).toBeNull();
    expect(validateCustomerDisplayMessage({ type: 'payment', phase: 'pending', amountMinorUnits: 'lots', changeMinorUnits: 0 })).toBeNull();
  });

  it('rejects an unknown command and a config without settings', () => {
    expect(validateCustomerDisplayMessage({ type: 'command', command: 'rm-rf' })).toBeNull();
    expect(validateCustomerDisplayMessage({ type: 'config' })).toBeNull();
  });
});

// Node 18+ exposes BroadcastChannel globally; these tests exercise real
// cross-instance delivery on the same channel name. Each bus is closed to avoid
// keeping the event loop alive.
describe('CustomerDisplayBus', () => {
  it('reports active when BroadcastChannel is supported', () => {
    const bus = new CustomerDisplayBus('caisse-test-active');
    expect(bus.isActive).toBe(typeof BroadcastChannel !== 'undefined');
    bus.close();
  });

  it('delivers a message from a publisher to a subscriber', async () => {
    if (typeof BroadcastChannel === 'undefined') return; // environment guard
    const pub = new CustomerDisplayBus('caisse-test-deliver');
    const sub = new CustomerDisplayBus('caisse-test-deliver');

    const received = new Promise<CustomerDisplayMessage>((resolve) => {
      sub.subscribe((msg) => resolve(msg));
    });

    pub.post({ type: 'command', command: 'ping' });

    const msg = await received;
    expect(msg.type).toBe('command');
    pub.close();
    sub.close();
  });

  it('unsubscribe stops delivery to that handler', async () => {
    if (typeof BroadcastChannel === 'undefined') return;
    const pub = new CustomerDisplayBus('caisse-test-unsub');
    const sub = new CustomerDisplayBus('caisse-test-unsub');

    let count = 0;
    const off = sub.subscribe(() => {
      count += 1;
    });
    off();

    pub.post({ type: 'command', command: 'ping' });
    await new Promise((r) => setTimeout(r, 30));
    expect(count).toBe(0);
    pub.close();
    sub.close();
  });

  it('post after close is a safe no-op', () => {
    const bus = new CustomerDisplayBus('caisse-test-closed');
    bus.close();
    expect(() => bus.post({ type: 'command', command: 'ping' })).not.toThrow();
  });

  it('drops an invalid inbound payload, counts it, and never calls handlers', async () => {
    if (typeof BroadcastChannel === 'undefined') return;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pub = new CustomerDisplayBus('caisse-test-invalid');
    const sub = new CustomerDisplayBus('caisse-test-invalid');

    let called = 0;
    sub.subscribe(() => { called += 1; });

    // Bypass the typed `post` to inject a malformed payload onto the wire.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pub.post({ type: 'command', command: 'rm-rf-the-till' } as any);
    await new Promise((r) => setTimeout(r, 40));

    expect(called).toBe(0);
    expect(sub.invalidPayloadCount).toBe(1);
    warn.mockRestore();
    pub.close();
    sub.close();
  });
});
