import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditEntryEntity } from '../../database/entities/audit-entry.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AuditEntryEntity])],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
