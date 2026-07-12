import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { AttractService } from './attract.service';
import { CreateAttractCampaignDto, UpdateAttractCampaignDto, SetAttractMediaDto } from './attract.dto';

@ApiTags('attract')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('attract')
export class AttractController {
  constructor(private readonly service: AttractService) {}

  // ── Consommé par l'écran client (POS) : playlist active de la caisse ──
  @Get('playlist')
  @ApiOperation({ summary: "Playlist attract active pour la caisse (résolveur écran client)" })
  playlist(@Query('terminalId') terminalId: string | undefined, @Request() req: any) {
    return this.service.resolvePlaylist(req.user.storeId, terminalId ?? null);
  }

  // ── Gestion (backoffice) : admin + manager ──
  @Get('campaigns')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Lister les campagnes (magasin + nationales)' })
  list(@Request() req: any) {
    return this.service.list(req.user.storeId);
  }

  @Get('campaigns/:id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Détail d’une campagne + playlist' })
  get(@Param('id') id: string, @Request() req: any) {
    return this.service.get(id, req.user.storeId);
  }

  @Post('campaigns')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Créer une campagne (national réservé admin)' })
  create(@Body() dto: CreateAttractCampaignDto, @Request() req: any) {
    return this.service.create(req.user.storeId, req.user.role, dto);
  }

  @Put('campaigns/:id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Modifier une campagne' })
  update(@Param('id') id: string, @Body() dto: UpdateAttractCampaignDto, @Request() req: any) {
    return this.service.update(id, req.user.storeId, req.user.role, dto);
  }

  @Put('campaigns/:id/media')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Remplacer la playlist ordonnée d’une campagne' })
  setMedia(@Param('id') id: string, @Body() dto: SetAttractMediaDto, @Request() req: any) {
    return this.service.setMedia(id, req.user.storeId, req.user.role, dto.media);
  }

  @Delete('campaigns/:id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Supprimer une campagne (médias en cascade)' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.service.remove(id, req.user.storeId, req.user.role);
  }
}
