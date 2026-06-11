/**
 * POS terminal registry — (1b) first brick tests.
 *
 * Two layers, mirroring the γ discipline:
 *   - Service-level: provision (dup refused), list, update/deactivate,
 *     validateClaim (cross-store refusal — the anti-spoof check).
 *   - DB-level (raw SQL, separate describe): the partial unique index
 *     itself rejects a second active row and allows deactivated history to
 *     coexist. Sequential service tests can't catch the provisioning race;
 *     this is the structural backstop's own test.
 *
 * NOT tested here (out of scope of this brick):
 *   - Binding operator → sale/void/return. That is the binding brick, where
 *     the dev-unblock vs fiscal-production line (#4) and the createReturn
 *     symmetry (#7) are decided.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { PosTerminalModule } from '../src/modules/pos-terminal/pos-terminal.module';
import { PosTerminalService } from '../src/modules/pos-terminal/pos-terminal.service';

describe('POS terminal registry — service', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let service: PosTerminalService;
  const STORE_A = uuidv4();
  const STORE_B = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({
            type: 'postgres',
            entities: loadAllEntities() as any,
            synchronize: true,
          }),
          dataSourceFactory: async () =>
            dataSource.isInitialized ? dataSource : dataSource.initialize(),
        }),
        PosTerminalModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    service = moduleRef.get(PosTerminalService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await ds.query('TRUNCATE pos_terminals');
  });

  describe('provision', () => {
    it('provisions a terminal for a store', async () => {
      const t = await service.provision(STORE_A, 'Caisse-1', 'Caisse 1');
      expect(t.id).toBeTruthy();
      expect(t.storeId).toBe(STORE_A);
      expect(t.terminalCode).toBe('Caisse-1');
      expect(t.label).toBe('Caisse 1');
      expect(t.isActive).toBe(true);
    });

    it('trims the code and label', async () => {
      const t = await service.provision(STORE_A, '  Caisse-1  ', '  Caisse 1  ');
      expect(t.terminalCode).toBe('Caisse-1');
      expect(t.label).toBe('Caisse 1');
    });

    it('refuses an empty code', async () => {
      await expect(service.provision(STORE_A, '   ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a duplicate active code in the same store', async () => {
      await service.provision(STORE_A, 'Caisse-1');
      await expect(service.provision(STORE_A, 'Caisse-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('allows the same code in two different stores', async () => {
      const a = await service.provision(STORE_A, 'Caisse-1');
      const b = await service.provision(STORE_B, 'Caisse-1');
      expect(a.id).not.toBe(b.id);
      expect(a.storeId).toBe(STORE_A);
      expect(b.storeId).toBe(STORE_B);
    });

    it('allows re-provisioning a code after the previous one is deactivated', async () => {
      const first = await service.provision(STORE_A, 'Caisse-1');
      await service.update(first.id, STORE_A, { isActive: false });
      const second = await service.provision(STORE_A, 'Caisse-1');
      expect(second.id).not.toBe(first.id);
      expect(second.isActive).toBe(true);
    });
  });

  describe('findAllByStore', () => {
    it('lists only active terminals of the store', async () => {
      await service.provision(STORE_A, 'Caisse-1');
      await service.provision(STORE_A, 'Caisse-2');
      await service.provision(STORE_B, 'Caisse-1');
      const list = await service.findAllByStore(STORE_A);
      expect(list).toHaveLength(2);
      expect(list.map((t) => t.terminalCode).sort()).toEqual([
        'Caisse-1',
        'Caisse-2',
      ]);
    });
  });

  describe('update', () => {
    it('updates the label', async () => {
      const t = await service.provision(STORE_A, 'Caisse-1', 'old');
      const updated = await service.update(t.id, STORE_A, { label: 'new' });
      expect(updated.label).toBe('new');
    });

    it('soft-deactivates', async () => {
      const t = await service.provision(STORE_A, 'Caisse-1');
      const updated = await service.update(t.id, STORE_A, { isActive: false });
      expect(updated.isActive).toBe(false);
    });

    it('refuses to update a terminal of a different store', async () => {
      const t = await service.provision(STORE_A, 'Caisse-1');
      await expect(
        service.update(t.id, STORE_B, { label: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to update a non-existent terminal', async () => {
      await expect(
        service.update(uuidv4(), STORE_A, { label: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('validateClaim — the anti-cross-store check (#4)', () => {
    it('returns the terminal when the claim matches an active terminal in the store', async () => {
      const t = await service.provision(STORE_A, 'Caisse-1');
      const found = await service.validateClaim(STORE_A, 'Caisse-1');
      expect(found?.id).toBe(t.id);
    });

    it('returns null when the code exists only in ANOTHER store (cross-store spoof refused)', async () => {
      await service.provision(STORE_B, 'Caisse-1');
      const found = await service.validateClaim(STORE_A, 'Caisse-1');
      expect(found).toBeNull();
    });

    it('returns null when the terminal is deactivated', async () => {
      const t = await service.provision(STORE_A, 'Caisse-1');
      await service.update(t.id, STORE_A, { isActive: false });
      const found = await service.validateClaim(STORE_A, 'Caisse-1');
      expect(found).toBeNull();
    });

    it('returns null on empty inputs', async () => {
      expect(await service.validateClaim('', 'Caisse-1')).toBeNull();
      expect(await service.validateClaim(STORE_A, '')).toBeNull();
    });

    it('does NOT distinguish intra-store codes (documents the residual gap #4)', async () => {
      // Both Caisse-1 and Caisse-2 are valid in store A. An operator can
      // claim either — the registry validates both. This is the intra-store
      // spoof the device credential must close; the registry alone cannot.
      await service.provision(STORE_A, 'Caisse-1');
      await service.provision(STORE_A, 'Caisse-2');
      expect(await service.validateClaim(STORE_A, 'Caisse-1')).not.toBeNull();
      expect(await service.validateClaim(STORE_A, 'Caisse-2')).not.toBeNull();
    });
  });
});

describe('POS terminal registry — DB-level invariant (partial unique index)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    // pgmem helper sets synchronize: true; initialize() builds the schema
    // including the partial unique index. Do NOT call synchronize() again
    // (introspection unsupported by pg-mem).
    ds = await dataSource.initialize();
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('rejects two ACTIVE rows with the same (store, code) — raw SQL, no service', async () => {
    await ds.query(
      `INSERT INTO pos_terminals (store_id, terminal_code, is_active)
       VALUES ('s1','Caisse-1',true)`,
    );
    await expect(
      ds.query(
        `INSERT INTO pos_terminals (store_id, terminal_code, is_active)
         VALUES ('s1','Caisse-1',true)`,
      ),
    ).rejects.toThrow();
  });

  it('allows a deactivated and an active row with the same (store, code) to coexist', async () => {
    await ds.query(
      `INSERT INTO pos_terminals (store_id, terminal_code, is_active)
       VALUES ('s2','Caisse-1',false)`,
    );
    await ds.query(
      `INSERT INTO pos_terminals (store_id, terminal_code, is_active)
       VALUES ('s2','Caisse-1',true)`,
    );
  });
});
