/**
 * Operator attribution side-table — (1b) foundation tests.
 *
 * Proves the side-table records attribution within a transaction, reads it
 * back, and computes the divergence metric (the v3-decision input) by join
 * — all WITHOUT any column on the hashed fiscal tables.
 *
 * Door-wiring (createSale/voidSale/createReturn calling this within their
 * own transactions) is tested separately once wired; here we prove the
 * foundation in isolation.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { OperatorAttributionModule } from '../src/modules/operator-attribution/operator-attribution.module';
import { OperatorAttributionService } from '../src/modules/operator-attribution/operator-attribution.service';
import { PosSessionEntity } from '../src/database/entities/pos-session.entity';

describe('Operator attribution — side-table foundation', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let service: OperatorAttributionService;
  const STORE = uuidv4();

  const mkSession = (employeeId: string, terminalId: string): PosSessionEntity => {
    const s = new PosSessionEntity();
    s.id = uuidv4();
    s.storeId = STORE;
    s.employeeId = employeeId;
    s.terminalId = terminalId;
    s.employeeName = 'X';
    s.employeeRole = 'cashier';
    s.maxDiscount = 0;
    s.permissions = {};
    s.isActive = true;
    s.offlineMode = false;
    return s;
  };

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
        OperatorAttributionModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    service = moduleRef.get(OperatorAttributionService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await ds.query('TRUNCATE operator_attribution');
    await ds.query('DELETE FROM sales');
  });

  it('records attribution within a transaction (session found)', async () => {
    const eventId = uuidv4();
    const session = mkSession('emp-A', 'Caisse-1');
    await ds.transaction(async (m) => {
      await service.recordWithinTransaction(m, {
        eventType: 'sale',
        eventId,
        storeId: STORE,
        terminalId: 'Caisse-1',
        session,
      });
    });
    const row = await service.findByEvent('sale', eventId);
    expect(row?.sessionOperatorId).toBe('emp-A');
    expect(row?.sessionTerminalId).toBe('Caisse-1');
    expect(row?.attributionSource).toBe('session');
  });

  it('records no_session when there is no active session (gap in data, never blocks)', async () => {
    const eventId = uuidv4();
    await ds.transaction(async (m) => {
      await service.recordWithinTransaction(m, {
        eventType: 'sale',
        eventId,
        storeId: STORE,
        terminalId: 'Caisse-9',
        session: null,
      });
    });
    const row = await service.findByEvent('sale', eventId);
    expect(row?.sessionOperatorId).toBeNull();
    expect(row?.sessionTerminalId).toBe('Caisse-9');
    expect(row?.attributionSource).toBe('no_session');
  });

  it('one attribution per event (unique on event_type+event_id)', async () => {
    const eventId = uuidv4();
    const session = mkSession('emp-A', 'Caisse-1');
    await ds.transaction((m) =>
      service.recordWithinTransaction(m, {
        eventType: 'sale',
        eventId,
        storeId: STORE,
        terminalId: 'Caisse-1',
        session,
      }),
    );
    await expect(
      ds.transaction((m) =>
        service.recordWithinTransaction(m, {
          eventType: 'sale',
          eventId,
          storeId: STORE,
          terminalId: 'Caisse-1',
          session,
        }),
      ),
    ).rejects.toThrow();
  });

  describe('divergence metric (v3-decision input)', () => {
    // Insert a minimal sale row so the join has a target.
    const insertSale = async (saleId: string, employeeId: string) => {
      await ds.query(
        `INSERT INTO sales (id, store_id, employee_id, ticket_number,
           subtotal_minor_units, discount_total_minor_units, tax_total_minor_units,
           total_minor_units, status, hash_chain_prev, hash_chain_current, hash_version)
         VALUES ($1,$2,$3,$4,0,0,0,0,'completed','0','h',2)`,
        [saleId, STORE, employeeId, 'T-' + saleId.slice(0, 6)],
      );
    };

    it('counts converge vs diverge: JWT operator vs session operator', async () => {
      // Sale 1: JWT operator emp-A, session also emp-A → converge.
      const s1 = uuidv4();
      await insertSale(s1, 'emp-A');
      await ds.transaction((m) =>
        service.recordWithinTransaction(m, {
          eventType: 'sale',
          eventId: s1,
          storeId: STORE,
          terminalId: 'Caisse-1',
          session: mkSession('emp-A', 'Caisse-1'),
        }),
      );

      // Sale 2: JWT operator emp-A, session emp-B → diverge (the signal).
      const s2 = uuidv4();
      await insertSale(s2, 'emp-A');
      await ds.transaction((m) =>
        service.recordWithinTransaction(m, {
          eventType: 'sale',
          eventId: s2,
          storeId: STORE,
          terminalId: 'Caisse-1',
          session: mkSession('emp-B', 'Caisse-1'),
        }),
      );

      // Sale 3: no session → not counted in diverged (no session view).
      const s3 = uuidv4();
      await insertSale(s3, 'emp-A');
      await ds.transaction((m) =>
        service.recordWithinTransaction(m, {
          eventType: 'sale',
          eventId: s3,
          storeId: STORE,
          terminalId: 'Caisse-9',
          session: null,
        }),
      );

      const d = await service.saleDivergenceForStore(STORE);
      expect(d.total).toBe(3);
      expect(d.withSession).toBe(2);
      expect(d.diverged).toBe(1); // only sale 2 (emp-A vs emp-B)
    });
  });
});
