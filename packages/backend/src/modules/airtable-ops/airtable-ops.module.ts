import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ProductEntity } from '../../database/entities/product.entity';
import { AirtableLinkedRecordEntity } from '../../database/entities/airtable-linked-record.entity';
import { AirtableSyncLogEntity } from '../../database/entities/airtable-sync-log.entity';
import { AirtableOperationEntity } from '../../database/entities/airtable-operation.entity';

import { AirtableOpsConfig } from './airtable-ops.config';
import { AirtableOpsMapper } from './airtable-ops.mapper';
import { AirtableOpsSyncService } from './airtable-ops.sync.service';
import { AirtableOpsService } from './airtable-ops.service';
import { AirtableOpsController } from './airtable-ops.controller';
import { AirtableSyncJob } from './jobs/airtable-sync.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      AirtableLinkedRecordEntity,
      AirtableSyncLogEntity,
      AirtableOperationEntity,
    ]),
  ],
  controllers: [AirtableOpsController],
  providers: [
    AirtableOpsConfig,
    AirtableOpsMapper,
    AirtableOpsSyncService,
    AirtableOpsService,
    AirtableSyncJob,
  ],
  exports: [AirtableOpsService],
})
export class AirtableOpsModule {}
