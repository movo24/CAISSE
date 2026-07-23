import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SaleEntity } from '../../database/entities/sale.entity';
import { StoreEntity } from '../../database/entities/store.entity';
import { CreditNoteEntity } from '../../database/entities/credit-note.entity';
import { ProductEntity } from '../../database/entities/product.entity';
import { DocumentsModule } from '../documents/documents.module';
import { PublicTicketController } from './public-ticket.controller';
import { PublicTicketService } from './public-ticket.service';

/**
 * Ticket numérique public (QR du ticket papier → page /ticket/:token).
 * Lecture seule stricte — reproduit la vente scellée, ne peut jamais la
 * modifier. Voir public-ticket.controller.ts pour le modèle de sécurité.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SaleEntity, StoreEntity, CreditNoteEntity, ProductEntity]),
    DocumentsModule,
  ],
  controllers: [PublicTicketController],
  providers: [PublicTicketService],
})
export class PublicTicketModule {}
