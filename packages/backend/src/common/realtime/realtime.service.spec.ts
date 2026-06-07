import { RealtimeService } from './realtime.service';

describe('RealtimeService', () => {
  it('streams only events for the subscribed store', async () => {
    const svc = new RealtimeService();
    const received: any[] = [];
    const sub = svc.streamForStore('s1').subscribe((m) => received.push(m.data));

    svc.emit('s1', 'sale.completed', { saleId: 'a' });
    svc.emit('s2', 'sale.completed', { saleId: 'b' }); // other store — ignored
    svc.emit('s1', 'sale.completed', { saleId: 'c' });

    sub.unsubscribe();
    expect(received).toEqual([
      { event: 'sale.completed', saleId: 'a' },
      { event: 'sale.completed', saleId: 'c' },
    ]);
  });

  it('a late subscriber does not receive past events (hot stream)', () => {
    const svc = new RealtimeService();
    svc.emit('s1', 'sale.completed', { saleId: 'past' });
    const received: any[] = [];
    const sub = svc.streamForStore('s1').subscribe((m) => received.push(m.data));
    svc.emit('s1', 'sale.completed', { saleId: 'live' });
    sub.unsubscribe();
    expect(received).toEqual([{ event: 'sale.completed', saleId: 'live' }]);
  });

  describe('Redis fan-out (multi-pod)', () => {
    it('publishes to Redis when active and does not push locally directly', () => {
      const svc = new RealtimeService();
      const pub = { publish: jest.fn().mockResolvedValue(1) };
      (svc as any).redisReady = true;
      (svc as any).pub = pub;

      const received: any[] = [];
      svc.streamForStore('s1').subscribe((m) => received.push(m.data));
      svc.emit('s1', 'sale.completed', { saleId: 'a' });

      expect(pub.publish).toHaveBeenCalledWith('realtime:events', expect.stringContaining('"saleId":"a"'));
      // Delivery to local clients happens via the subscriber (round-trip), not directly.
      expect(received).toEqual([]);
    });

    it('falls back to in-process delivery when a Redis publish rejects', async () => {
      const svc = new RealtimeService();
      const pub = { publish: jest.fn().mockRejectedValue(new Error('redis down')) };
      (svc as any).redisReady = true;
      (svc as any).pub = pub;

      const received: any[] = [];
      svc.streamForStore('s1').subscribe((m) => received.push(m.data));
      svc.emit('s1', 'sale.completed', { saleId: 'b' });
      await new Promise((r) => setImmediate(r)); // let the rejected publish settle

      expect(received).toEqual([{ event: 'sale.completed', saleId: 'b' }]);
    });
  });
});
