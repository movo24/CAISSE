import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Access-control tests for the ?storeId param (Increment F):
 * only an admin may target another store's audit chain (e.g. the global
 * '_admin' chain holding admin_login events). A manager is hard-locked to
 * its own store — the param must be ignored, never trusted.
 */
describe('AuditController — ?storeId access control', () => {
  let controller: AuditController;
  let service: { getEntries: jest.Mock; verifyChain: jest.Mock };

  beforeEach(async () => {
    service = {
      getEntries: jest.fn().mockResolvedValue([]),
      verifyChain: jest.fn().mockResolvedValue({ valid: true }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: service }],
    }).compile();
    controller = module.get(AuditController);
  });

  const adminReq = { user: { role: 'admin', storeId: 'store-1' } };
  const managerReq = { user: { role: 'manager', storeId: 'store-1' } };

  it('admin can read the global _admin chain via ?storeId', async () => {
    await controller.getEntries(adminReq, undefined, undefined, '_admin');
    expect(service.getEntries).toHaveBeenCalledWith('_admin', 100, 0);
  });

  it('admin defaults to own store when no ?storeId', async () => {
    await controller.getEntries(adminReq, undefined, undefined, undefined);
    expect(service.getEntries).toHaveBeenCalledWith('store-1', 100, 0);
  });

  it('manager CANNOT read another store — ?storeId is ignored', async () => {
    await controller.getEntries(managerReq, undefined, undefined, '_admin');
    expect(service.getEntries).toHaveBeenCalledWith('store-1', 100, 0);
  });

  it('verifyChain: admin can target the _admin chain via ?storeId', async () => {
    await controller.verifyChain(adminReq, '_admin');
    expect(service.verifyChain).toHaveBeenCalledWith('_admin');
  });

  it('verifyChain: defaults to own store when no ?storeId', async () => {
    await controller.verifyChain(adminReq, undefined);
    expect(service.verifyChain).toHaveBeenCalledWith('store-1');
  });

  it('respects limit/offset parsing alongside storeId', async () => {
    await controller.getEntries(adminReq, '50', '10', '_admin');
    expect(service.getEntries).toHaveBeenCalledWith('_admin', 50, 10);
  });
});
