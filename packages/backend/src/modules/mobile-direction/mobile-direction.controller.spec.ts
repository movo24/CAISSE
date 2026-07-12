import { BadRequestException, NotFoundException } from '@nestjs/common';

import { MobileDirectionController } from './mobile-direction.controller';

const SCOPE_A = '11111111-1111-4111-8111-111111111111';
const SCOPE_B = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '99999999-9999-4999-8999-999999999999';

function makeController(scope: string[] = [SCOPE_A, SCOPE_B]) {
  const service = {
    accessibleStoreIds: jest.fn().mockResolvedValue(scope),
    overview: jest.fn().mockResolvedValue({ ok: 'overview' }),
    storeList: jest.fn().mockResolvedValue({ ok: 'stores' }),
    storeDetail: jest.fn().mockResolvedValue({ ok: 'detail' }),
    compare: jest.fn().mockResolvedValue({ ok: 'compare' }),
  };
  return {
    controller: new MobileDirectionController(service as any),
    service,
  };
}

const reqManager = {
  user: { employeeId: 'emp-1', storeId: SCOPE_A, role: 'manager' },
};

describe('MobileDirectionController', () => {
  describe('date validation', () => {
    it('defaults to today when no date is given', async () => {
      const { controller, service } = makeController();
      await controller.overview(reqManager, undefined);
      const day = service.overview.mock.calls[0][1];
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('rejects malformed dates with 400', async () => {
      const { controller } = makeController();
      await expect(
        controller.overview(reqManager, 'not-a-date'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.overview(reqManager, '2026-13-45'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a valid ISO day and passes it through', async () => {
      const { controller, service } = makeController();
      await controller.overview(reqManager, '2026-07-10');
      expect(service.overview).toHaveBeenCalledWith(
        [SCOPE_A, SCOPE_B],
        '2026-07-10',
      );
    });
  });

  describe('scope enforcement (anti-enumeration)', () => {
    it('serves a store detail inside the scope', async () => {
      const { controller, service } = makeController();
      await controller.storeDetail(SCOPE_B, reqManager, '2026-07-10');
      expect(service.storeDetail).toHaveBeenCalledWith(SCOPE_B, '2026-07-10');
    });

    it('404s (default body) on an out-of-scope store — same as non-existent', async () => {
      const { controller, service } = makeController();
      await expect(
        controller.storeDetail(FOREIGN, reqManager, '2026-07-10'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(service.storeDetail).not.toHaveBeenCalled();
    });

    it('404s in compare when ANY requested store is out of scope', async () => {
      const { controller, service } = makeController();
      await expect(
        controller.compare(
          reqManager,
          `${SCOPE_A},${FOREIGN}`,
          '2026-07-01',
          '2026-07-10',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(service.compare).not.toHaveBeenCalled();
    });
  });

  describe('compare input validation', () => {
    it('requires storeIds', async () => {
      const { controller } = makeController();
      await expect(
        controller.compare(reqManager, '', '2026-07-01', '2026-07-10'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects non-UUID store ids (no SQL surprises)', async () => {
      const { controller } = makeController();
      await expect(
        controller.compare(
          reqManager,
          "1;DROP TABLE sales",
          '2026-07-01',
          '2026-07-10',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('caps the number of compared stores at 10', async () => {
      const scope = Array.from(
        { length: 11 },
        (_, i) =>
          `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      );
      const { controller } = makeController(scope);
      await expect(
        controller.compare(
          reqManager,
          scope.join(','),
          '2026-07-01',
          '2026-07-10',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an inverted range', async () => {
      const { controller } = makeController();
      await expect(
        controller.compare(reqManager, SCOPE_A, '2026-07-10', '2026-07-01'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('passes a valid in-scope comparison through', async () => {
      const { controller, service } = makeController();
      await controller.compare(
        reqManager,
        ` ${SCOPE_A}, ${SCOPE_B} `,
        '2026-07-01',
        '2026-07-10',
      );
      expect(service.compare).toHaveBeenCalledWith(
        [SCOPE_A, SCOPE_B],
        '2026-07-01',
        '2026-07-10',
      );
    });
  });

  describe('read-only + role guard wiring (metadata)', () => {
    it('exposes only GET handlers (no mutation surface)', () => {
      const proto = MobileDirectionController.prototype as any;
      for (const handler of ['overview', 'stores', 'storeDetail', 'compare']) {
        // Nest RequestMapping metadata: method 0 = GET
        expect(Reflect.getMetadata('method', proto[handler])).toBe(0);
      }
    });

    it('requires the manager role (admin inherits) on every handler', () => {
      const proto = MobileDirectionController.prototype as any;
      for (const handler of ['overview', 'stores', 'storeDetail', 'compare']) {
        expect(Reflect.getMetadata('roles', proto[handler])).toEqual([
          'manager',
        ]);
      }
    });
  });
});
