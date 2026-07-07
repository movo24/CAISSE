import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { CreateEmployeeDto, UpdateEmployeeDto } from '../../common/dto';

@ApiTags('employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  // ── Rights endpoints (static routes BEFORE :id) ──

  @Get('me/rights')
  @ApiOperation({ summary: 'Get current employee rights' })
  async getMyRights(@Request() req: any) {
    return this.employeesService.getEmployeeRights(
      req.user.employeeId,
      req.user.storeId,
    );
  }

  @Get('rights/defaults')
  @ApiOperation({ summary: 'Get role-based default rights' })
  getRoleDefaults() {
    return this.employeesService.getAllDefaultRights();
  }

  @Get(':id/rights')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get rights for a specific employee' })
  async getEmployeeRights(@Param('id') id: string, @Request() req: any) {
    return this.employeesService.getEmployeeRights(id, req.user.storeId);
  }

  // ── CRUD endpoints ──

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create an employee' })
  create(@Body() dto: CreateEmployeeDto, @Request() req: any) {
    return this.employeesService.create({ ...dto, storeId: req.user.storeId });
  }

  @Get()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'List employees for store' })
  findAll(@Request() req: any) {
    return this.employeesService.findAll(req.user.storeId);
  }

  @Get(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get employee details' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.employeesService.findOneForStore(id, req.user.storeId);
  }

  @Get(':id/qr')
  @ApiOperation({ summary: 'Get employee QR code image (data URL)' })
  async getQr(@Param('id') id: string, @Request() req: any) {
    const dataUrl = await this.employeesService.generateQrImage(
      id,
      req.user.storeId,
    );
    return { qrCodeDataUrl: dataUrl };
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update employee' })
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @Request() req: any) {
    return this.employeesService.update(id, dto, req.user.storeId);
  }

  @Patch(':id/pin')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Change an employee PIN (validated + unique per store)' })
  changePin(
    @Param('id') id: string,
    @Body() body: { pin: string },
    @Request() req: any,
  ) {
    return this.employeesService.changePin(
      id,
      body?.pin,
      req.user.storeId,
      req.user.employeeId,
    );
  }

  @Post(':id/deactivate')
  @Roles('admin')
  @ApiOperation({ summary: 'Deactivate employee (soft-delete)' })
  deactivate(@Param('id') id: string, @Request() req: any) {
    return this.employeesService.deactivate(id, req.user.storeId);
  }

  @Post(':id/reactivate')
  @Roles('admin')
  @ApiOperation({ summary: 'Reactivate a deactivated employee' })
  reactivate(@Param('id') id: string, @Request() req: any) {
    return this.employeesService.reactivate(id, req.user.storeId);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Deactivate employee (alias for POST deactivate)' })
  deactivateViaDelete(@Param('id') id: string, @Request() req: any) {
    return this.employeesService.deactivate(id, req.user.storeId);
  }
}
