import { describe, it, expect } from 'vitest';
import { CustomerDisplayBus, type CustomerDisplayMessage } from './bus';

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
});
