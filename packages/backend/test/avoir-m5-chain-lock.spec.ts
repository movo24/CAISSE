/**
 * Fiscal fix M5 — the per-store credit-note (avoir) hash chain must be
 * serialized with the SAME pessimistic lock the sales path uses
 * (`SELECT id FROM stores WHERE id = $1 FOR UPDATE`), taken BEFORE reading the
 * previous hash. Otherwise two concurrent returns / gift-cards read the same
 * prevHash and fork the chain.
 *
 * pg-mem is single-threaded and cannot reproduce a real race, so we assert the
 * verifiable invariant instead: in the credit-note transaction the `stores …
 * FOR UPDATE` lock is issued, and it precedes the `credit_notes … hash_chain`
 * read. We also assert the chain links correctly across sequential issues.
 */
import './helpers/env-setup';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { createPgMemDataSource, loadAllEntities } from './helpers/pgmem';
import { SalesModule } from '../src/modules/sales/sales.module';
import { ReturnsModule } from '../src/modules/returns/returns.module';
import { CacheModule } from '../src/common/cache/cache.module';
import { MessagingModule } from '../src/common/messaging/messaging.module';
import { RealtimeModule } from '../src/common/realtime/realtime.module';
import { TimewinModule } from '../src/modules/timewin/timewin.module';
import { ReturnsService } from '../src/modules/returns/returns.service';
import { StoreEntity } from '../src/database/entities/store.entity';

const GENESIS = '0'.repeat(64);
const lockRe = /from\s+stores\s+where\s+id\s*=\s*\$1\s+for\s+update/i;
const prevHashRe = /credit_notes[\s\S]*hash_chain_current/i;

describe('Fiscal — M5 (avoir chain serialized with stores FOR UPDATE)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let returns: ReturnsService;
  let captured: string[] = [];
  let origCreate: () => any;
  const STORE_ID = uuidv4();
  const EMP_ID = uuidv4();

  beforeAll(async () => {
    const { dataSource } = createPgMemDataSource();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({ type: 'postgres', entities: loadAllEntities() as any, synchronize: true }),
          dataSourceFactory: async () => (dataSource.isInitialized ? dataSource : dataSource.initialize()),
        }),
        CacheModule, MessagingModule, RealtimeModule, TimewinModule, SalesModule, ReturnsModule,
      ],
    }).compile();
    ds = moduleRef.get(DataSource);
    returns = moduleRef.get(ReturnsService);

    await ds.getRepository(StoreEntity).save({ id: STORE_ID, name: 'S', storeCode: 'S1', currencyCode: 'EUR', isActive: true } as any);

    // Wrap createQueryRunner so every SQL string the service runs is recorded,
    // in execution order, without changing behaviour.
    origCreate = ds.createQueryRunner.bind(ds);
    (ds as any).createQueryRunner = (...args: any[]) => {
      const qr = (origCreate as any)(...args);
      const origQuery = qr.query.bind(qr);
      // Forward ALL args (TypeORM internals pass a 3rd `useStructuredResult`).
      qr.query = (...qargs: any[]) => {
        captured.push(String(qargs[0]));
        return origQuery(...qargs);
      };
      return qr;
    };
  });

  afterAll(async () => {
    if (origCreate) (ds as any).createQueryRunner = origCreate;
    await moduleRef?.close();
  });

  beforeEach(() => { captured = []; });

  it('M5 — issueGiftCard prend le verrou stores FOR UPDATE AVANT de lire le prevHash', async () => {
    const cn: any = await returns.issueGiftCard(STORE_ID, EMP_ID, { amountMinorUnits: 5000 }, 'Alice');
    expect(cn.hashChainCurrent).toBeTruthy();

    const lockIdx = captured.findIndex((s) => lockRe.test(s));
    const prevIdx = captured.findIndex((s) => prevHashRe.test(s));

    expect(lockIdx).toBeGreaterThanOrEqual(0);      // le verrou est bien pris
    expect(prevIdx).toBeGreaterThanOrEqual(0);       // le prevHash est bien lu
    expect(lockIdx).toBeLessThan(prevIdx);           // verrou AVANT lecture du prevHash
  });

  it('M5 — la chaîne avoir lie correctement deux émissions séquentielles (pas de fork)', async () => {
    const a: any = await returns.issueGiftCard(STORE_ID, EMP_ID, { amountMinorUnits: 1000 }, 'Alice');
    const b: any = await returns.issueGiftCard(STORE_ID, EMP_ID, { amountMinorUnits: 2000 }, 'Alice');

    // b chaîne sur a : prev(b) == current(a), et chaque maillon est distinct.
    expect(b.hashChainPrev).toBe(a.hashChainCurrent);
    expect(b.hashChainCurrent).not.toBe(a.hashChainCurrent);
    expect(a.hashChainPrev).not.toBe(GENESIS); // déjà des avoirs émis avant dans cette suite
  });
});
