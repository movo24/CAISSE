import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StoresService } from './stores.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { UpdateStoreDto } from '../../common/dto';

@ApiTags('stores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('stores')
export class StoresController {
  constructor(private storesService: StoresService) {}

  /**
   * GET /api/stores/me — returns the authenticated user's own store.
   * No cross-tenant leak: you can only see YOUR store.
   */
  @Get('me')
  @ApiOperation({ summary: 'Get my store details' })
  getMyStore(@Request() req: any) {
    return this.storesService.findMyStore(req.user.storeId);
  }

  /**
   * GET /api/stores/me/info — returns store info formatted for POS ticket rendering.
   * Maps StoreEntity fields to the frontend StoreInfo interface.
   */
  @Get('me/info')
  @ApiOperation({ summary: 'Get store info for POS (StoreInfo format)' })
  getMyStoreInfo(@Request() req: any) {
    return this.storesService.getStoreInfo(req.user.storeId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a store by ID (must be your own store)' })
  findOne(@Param('id') id: string, @Request() req: any) {
    // Only allow accessing your own store
    if (id !== req.user.storeId) {
      return this.storesService.findMyStore(req.user.storeId);
    }
    return this.storesService.findMyStore(id);
  }

  @Put(':id')
  @Roles('admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Update your store' })
  update(@Param('id') id: string, @Body() dto: UpdateStoreDto, @Request() req: any) {
    return this.storesService.update(id, dto, req.user.storeId);
  }
}
