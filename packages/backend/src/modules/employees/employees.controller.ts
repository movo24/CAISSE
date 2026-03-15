import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
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

// ── Role-based defaults ──
const ROLE_RIGHTS: Record<string, any> = {
  admin: {
    role: 'admin',
    maxDiscountPercent: 100,
    canVoidSale: true,
    canRefund: true,
    canAccessReports: true,
    canManageStock: true,
    canDeleteTicket: true,
    canApplyManualDiscount: true,
    canOpenDrawer: true,
    canReprintTicket: true,
  },
  manager: {
    role: 'manager',
    maxDiscountPercent: 20,
    canVoidSale: true,
    canRefund: true,
    canAccessReports: true,
    canManageStock: true,
    canDeleteTicket: false,
    canApplyManualDiscount: true,
    canOpenDrawer: true,
    canReprintTicket: true,
  },
  cashier: {
    role: 'cashier',
    maxDiscountPercent: 5,
    canVoidSale: false,
    canRefund: false,
    canAccessReports: false,
    canManageStock: false,
    canDeleteTicket: false,
    canApplyManualDiscount: false,
    canOpenDrawer: false,
    canReprintTicket: true,
  },
};

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
    const emp = await this.employeesService.findOneForStore(
      req.user.employeeId,
      req.user.storeId,
    );
    const defaults = ROLE_RIGHTS[emp.role] || ROLE_RIGHTS.cashier;
    return {
      employeeId: emp.id,
      ...defaults,
      maxDiscountPercent: emp.maxDiscountPercent ?? defaults.maxDiscountPercent,
      isOverride: false,
      updatedAt: emp.createdAt,
    };
  }

  @Get('rights/defaults')
  @ApiOperation({ summary: 'Get role-based default rights' })
  getRoleDefaults() {
    return ROLE_RIGHTS;
  }

  @Get(':id/rights')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get rights for a specific employee' })
  async getEmployeeRights(@Param('id') id: string, @Request() req: any) {
    const emp = await this.employeesService.findOneForStore(id, req.user.storeId);
    const defaults = ROLE_RIGHTS[emp.role] || ROLE_RIGHTS.cashier;
    return {
      employeeId: emp.id,
      ...defaults,
      maxDiscountPercent: emp.maxDiscountPercent ?? defaults.maxDiscountPercent,
      isOverride: false,
      updatedAt: emp.createdAt,
    };
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

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Deactivate employee' })
  deactivate(@Param('id') id: string, @Request() req: any) {
    return this.employeesService.deactivate(id, req.user.storeId);
  }
}
