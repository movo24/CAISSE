import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupplierEntity } from '../../database/entities/supplier.entity';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { AuditModule } from '../audit/audit.module';

/** P327 — variantes option A : référentiel fournisseur. Cycle Q : mutations auditées. */
@Module({
  imports: [TypeOrmModule.forFeature([SupplierEntity]), AuditModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
