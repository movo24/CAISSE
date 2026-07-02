import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto, UpdateSupplierDto } from '../../common/dto/suppliers.dto';

/** P327 — CRUD fournisseur (variantes option A). Lecture: tout JWT ; écriture: manager+. */
@ApiTags('suppliers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @Get()
  @ApiOperation({ summary: 'List store suppliers (active by default; ?includeInactive=true for all)' })
  list(@Request() req: any, @Query('includeInactive') includeInactive?: string) {
    return this.service.list(req.user.storeId, includeInactive === 'true');
  }

  @Post()
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create a supplier (name unique per store)' })
  create(@Body() dto: CreateSupplierDto, @Request() req: any) {
    return this.service.create(req.user.storeId, dto);
  }

  @Put(':id')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Update a supplier' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto, @Request() req: any) {
    return this.service.update(id, req.user.storeId, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Deactivate a supplier (soft — products keep the reference)' })
  deactivate(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.deactivate(id, req.user.storeId);
  }
}
