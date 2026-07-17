import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SkipTenantCheck } from '../../common/interceptors/tenant.interceptor';
import { PublicTicketService } from './public-ticket.service';
import { buildTicketPageHtml } from './ticket-page.html';

/**
 * Ticket numérique public — https://<domaine>/ticket/<jeton>.
 *
 * - Servi HORS du préfixe /api (exclusion dans main.ts) pour une URL courte
 *   scannée sur le ticket papier ; le QR contient UNIQUEMENT le jeton opaque
 *   (jamais l'id interne de vente ni une donnée client).
 * - Aucune auth : l'accès EST le jeton (192 bits aléatoires, non énumérable).
 * - Lecture seule stricte : aucune route d'écriture n'existe ici.
 * - Anti-scan massif : throttle dédié, plus strict que le tier global.
 * - 404 opaque identique pour « format invalide » et « inconnu ».
 */
@ApiTags('public-ticket')
@Controller('ticket')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class PublicTicketController {
  constructor(private readonly service: PublicTicketService) {}

  /** Page mobile-first du ticket numérique (identité The Wesley). */
  @Get(':token')
  @SkipTenantCheck()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @ApiOperation({ summary: 'Public digital ticket page (QR code target)' })
  async getTicketPage(@Param('token') token: string): Promise<string> {
    const data = await this.service.getTicketByToken(token);
    return buildTicketPageHtml(data, token);
  }

  /** Données JSON du ticket (même contenu que la page, pour intégrations). */
  @Get(':token/data')
  @SkipTenantCheck()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Public digital ticket data (JSON)' })
  async getTicketData(@Param('token') token: string) {
    return this.service.getTicketByToken(token);
  }

  /** Téléchargement PDF (rendu verbatim des montants scellés). */
  @Get(':token/pdf')
  @SkipTenantCheck()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Download the digital ticket as PDF' })
  async getTicketPdf(@Param('token') token: string, @Res() res: Response) {
    const { filename, bytes } = await this.service.getTicketPdf(token);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  }
}
