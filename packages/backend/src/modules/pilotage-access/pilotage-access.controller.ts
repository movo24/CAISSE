import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SkipTenantCheck } from '../../common/interceptors/tenant.interceptor';
import { AccessService } from './access.service';
import { StoreAccessGuard } from './store-access.guard';
import { RequireStoreAccess } from './require-store-access.decorator';

/**
 * Endpoints de pilotage-access.
 *
 * `@SkipTenantCheck` car le périmètre multi-magasins est géré par AccessService /
 * StoreAccessGuard (le TenantInterceptor mono-magasin bloquerait un régional).
 */
@ApiTags('pilotage-access')
@ApiBearerAuth()
@Controller('pilotage/access')
@UseGuards(JwtAuthGuard)
@SkipTenantCheck()
export class PilotageAccessController {
  constructor(private readonly access: AccessService) {}

  /** Périmètre effectif du demandeur — le frontend n'affiche que ce qu'il peut voir. */
  @Get('me')
  @ApiOperation({ summary: 'Périmètre magasin effectif du demandeur' })
  async me(@Req() req: any) {
    const { employeeId, role } = req.user;
    if (role === 'admin') {
      return { employeeId, global: true, storeIds: [], applicationRole: 'CENTRAL_ADMIN' };
    }
    const scope = await this.access.listAccessibleStores(employeeId);
    return { employeeId, ...scope };
  }

  /** Sonde d'autorisation : 200 si le magasin est dans le périmètre, sinon 403. */
  @Get('check/:storeId')
  @UseGuards(StoreAccessGuard)
  @RequireStoreAccess()
  @ApiOperation({ summary: 'Vérifie l’accès du demandeur à un magasin' })
  check(@Param('storeId') storeId: string) {
    return { allowed: true, storeId };
  }
}
