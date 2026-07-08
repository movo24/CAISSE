import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PdfService } from './pdf.service';
import { DocumentsController } from './documents.controller';
import { SalesModule } from '../sales/sales.module';
import { ReturnsModule } from '../returns/returns.module';
import { ReportsModule } from '../reports/reports.module';
import { StoreEntity } from '../../database/entities/store.entity';

/**
 * DocumentsModule — génération de documents PDF + exposition réseau (PR #31).
 *
 * Les routes (duplicata ticket / justificatif avoir / export Z) sont JWT-gated,
 * tenant-scopées via les services métier, et strictement en lecture + rendu :
 * les montants sont imprimés verbatim (règle fiscale du PdfService), l'export Z
 * lit un Z scellé existant et ne génère jamais.
 */
@Module({
  imports: [
    SalesModule,
    ReturnsModule,
    ReportsModule,
    TypeOrmModule.forFeature([StoreEntity]),
  ],
  controllers: [DocumentsController],
  providers: [PdfService],
  exports: [PdfService],
})
export class DocumentsModule {}
