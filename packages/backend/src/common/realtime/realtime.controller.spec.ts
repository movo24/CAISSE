import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';

describe('RealtimeController — SSE auth', () => {
  const realtime = new RealtimeService();
  const make = (verify: jest.Mock) =>
    new RealtimeController(realtime, { verify } as unknown as JwtService);

  it('rejects an invalid token', () => {
    const ctrl = make(jest.fn(() => { throw new Error('bad'); }));
    expect(() => ctrl.sales('bad-token', 's1')).toThrow(UnauthorizedException);
  });

  it('lets a store user subscribe to its own store', () => {
    const ctrl = make(jest.fn().mockReturnValue({ storeId: 's1', role: 'cashier' }));
    expect(() => ctrl.sales('tok', 's1')).not.toThrow();
  });

  it('forbids a store user from subscribing to another store', () => {
    const ctrl = make(jest.fn().mockReturnValue({ storeId: 's1', role: 'cashier' }));
    expect(() => ctrl.sales('tok', 's2')).toThrow(ForbiddenException);
  });

  it('lets an admin subscribe to any store', () => {
    const ctrl = make(jest.fn().mockReturnValue({ storeId: 's1', role: 'admin' }));
    expect(() => ctrl.sales('tok', 's9')).not.toThrow();
  });
});
