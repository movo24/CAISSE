import { Module } from '@nestjs/common';
import { PdfService } from './pdf.service';

/**
 * DocumentsModule — génération de documents PDF isolée.
 *
 * Exporte PdfService pour qu'un module métier (reports, sales, returns) puisse
 * brancher un endpoint de téléchargement/email plus tard. Volontairement sans
 * controller ici : le périmètre de cette phase est le service + ses tests, pas
 * l'exposition réseau (qui demandera auth + choix de route).
 */
@Module({
  providers: [PdfService],
  exports: [PdfService],
})
export class DocumentsModule {}
