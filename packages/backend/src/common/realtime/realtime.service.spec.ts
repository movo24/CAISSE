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
});
