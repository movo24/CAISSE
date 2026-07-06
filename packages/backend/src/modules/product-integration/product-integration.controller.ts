import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { ProductIntegrationService } from './product-integration.service';
import {
  CreateIntegrationRequestDto,
  CreateSecuredProductDto,
  AuthorizeOperatorDto,
  ApproveIntegrationRequestDto,
  RejectIntegrationRequestDto,
  IntegrationSource,
} from '../../common/dto';

/**
 * Intégration produit — scan de code-barres inconnu.
 *
 * La caisse (rôle cashier) peut UNIQUEMENT :
 *   - rechercher un code-barres (`GET scan/:barcode`) ;
 *   - créer une demande d'intégration (`POST requests`).
 * La création/activation de fiche produit exige une session manager/admin ou
 * un code PIN opérateur autorisé (vérifié dans le service, tentative refusée
 * journalisée).
 */
@ApiTags('product-integration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('product-integration')
export class ProductIntegrationController {
  constructor(private service: ProductIntegrationService) {}

  @Get('scan/:barcode')
  @ApiOperation({ summary: 'Recherche un code-barres (fiche + stock + prix, ou inconnu)' })
  scan(
    @Param('barcode') barcode: string,
    @Request() req: any,
    @Query('source') source?: string,
    @Query('terminalId') terminalId?: string,
  ) {
    return this.service.scan(
      req.user.storeId,
      req.user.employeeId,
      barcode,
      (source as IntegrationSource) || 'dashboard',
      terminalId,
    );
  }

  @Post('requests')
  @ApiOperation({ summary: "Crée une demande d'intégration produit (seule action caisse)" })
  createRequest(@Body() dto: CreateIntegrationRequestDto, @Request() req: any) {
    return this.service.createRequest(req.user.storeId, req.user.employeeId, dto);
  }

  @Get('requests')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: "Liste les demandes d'intégration du magasin" })
  listRequests(
    @Request() req: any,
    @Query('status') status?: 'pending' | 'converted' | 'rejected',
  ) {
    return this.service.listRequests(req.user.storeId, status);
  }

  @Post('authorize')
  @ApiOperation({ summary: 'Vérifie un code opérateur (admin / employé autorisé)' })
  authorize(@Body() dto: AuthorizeOperatorDto, @Request() req: any) {
    return this.service.verifyOperatorPin(
      req.user.storeId,
      req.user.employeeId,
      dto.pin,
      { action: 'authorize' },
    );
  }

  @Post('products')
  @ApiOperation({
    summary:
      'Crée une fiche produit (session manager/admin OU code PIN autorisé obligatoire)',
  })
  createProduct(@Body() dto: CreateSecuredProductDto, @Request() req: any) {
    return this.service.createProduct(
      req.user.storeId,
      { employeeId: req.user.employeeId, role: req.user.role },
      dto,
    );
  }

  @Post('requests/:id/approve')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Approuve une demande → crée la fiche produit' })
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveIntegrationRequestDto,
    @Request() req: any,
  ) {
    return this.service.approveRequest(
      req.user.storeId,
      { employeeId: req.user.employeeId, role: req.user.role },
      id,
      dto,
    );
  }

  @Post('requests/:id/reject')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Rejette une demande (raison journalisée)' })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectIntegrationRequestDto,
    @Request() req: any,
  ) {
    return this.service.rejectRequest(
      req.user.storeId,
      req.user.employeeId,
      id,
      dto.reason,
    );
  }

  @Get('products/pending')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Liste les produits en attente de validation' })
  listPendingProducts(@Request() req: any) {
    return this.service.listPendingProducts(req.user.storeId);
  }

  @Post('products/:id/activate')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Active un produit en attente de validation' })
  activateProduct(@Param('id') id: string, @Request() req: any) {
    return this.service.activateProduct(
      req.user.storeId,
      { employeeId: req.user.employeeId, role: req.user.role },
      id,
    );
  }

  @Post('products/:id/reject')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Rejette un produit en attente de validation' })
  rejectProduct(
    @Param('id') id: string,
    @Body() dto: RejectIntegrationRequestDto,
    @Request() req: any,
  ) {
    return this.service.rejectProduct(
      req.user.storeId,
      { employeeId: req.user.employeeId, role: req.user.role },
      id,
      dto.reason,
    );
  }
}
