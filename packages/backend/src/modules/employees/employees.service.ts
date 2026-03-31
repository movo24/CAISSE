import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { EmployeeEntity } from '../../database/entities/employee.entity';

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

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(EmployeeEntity)
    private employeeRepo: Repository<EmployeeEntity>,
  ) {}

  async create(data: {
    firstName: string;
    lastName: string;
    email: string;
    pin: string;
    role: string;
    storeId: string;
    maxDiscountPercent?: number;
  }): Promise<EmployeeEntity & { qrCodeDataUrl: string }> {
    const pinHash = await bcrypt.hash(data.pin, 12);
    // Generate random 6-digit employee code (numeric, unique)
    let employeeCode: string;
    let attempts = 0;
    do {
      employeeCode = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits: 100000-999999
      const exists = await this.employeeRepo.findOne({ where: { qrCode: employeeCode } });
      if (!exists) break;
      attempts++;
    } while (attempts < 10);
    const qrCode = employeeCode;

    const employee = this.employeeRepo.create({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      pinHash,
      qrCode,
      role: data.role,
      storeId: data.storeId,
      maxDiscountPercent: data.maxDiscountPercent ?? 5,
    });
    const saved = await this.employeeRepo.save(employee);
    const qrCodeDataUrl = await QRCode.toDataURL(qrCode);

    return { ...saved, qrCodeDataUrl };
  }

  async findAll(storeId: string): Promise<EmployeeEntity[]> {
    return this.employeeRepo.find({
      where: { storeId, isActive: true },
      order: { lastName: 'ASC' },
    });
  }

  async findOne(id: string, storeId?: string): Promise<EmployeeEntity> {
    const where: any = { id };
    if (storeId) where.storeId = storeId;
    const emp = await this.employeeRepo.findOne({ where });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }

  /** Verify employee belongs to store — throws ForbiddenException if not */
  async findOneForStore(id: string, storeId: string): Promise<EmployeeEntity> {
    const emp = await this.employeeRepo.findOne({
      where: { id, storeId },
    });
    if (!emp) {
      throw new ForbiddenException(
        'Employee not found or belongs to another store.',
      );
    }
    return emp;
  }

  async update(
    id: string,
    data: Partial<EmployeeEntity> & { pin?: string },
    storeId: string,
  ): Promise<EmployeeEntity> {
    await this.findOneForStore(id, storeId);
    if (data.pin) {
      (data as any).pinHash = await bcrypt.hash(data.pin, 12);
      delete data.pin;
    }
    await this.employeeRepo.update(id, data as any);
    return this.findOneForStore(id, storeId);
  }

  async deactivate(id: string, storeId: string): Promise<{ message: string }> {
    const emp = await this.findOneForStore(id, storeId);
    await this.employeeRepo.update(id, { isActive: false });
    return { message: `${emp.firstName} ${emp.lastName} désactivé.` };
  }

  async reactivate(id: string, storeId: string): Promise<EmployeeEntity> {
    // Find even inactive employees
    const emp = await this.employeeRepo.findOne({ where: { id, storeId } });
    if (!emp) throw new Error('Employé introuvable');
    emp.isActive = true;
    return this.employeeRepo.save(emp);
  }

  async generateQrImage(id: string, storeId: string): Promise<string> {
    const emp = await this.findOneForStore(id, storeId);
    return QRCode.toDataURL(emp.qrCode);
  }

  /** Return the default rights map for a given role */
  getDefaultRights(role: string): Record<string, any> {
    return ROLE_RIGHTS[role] || ROLE_RIGHTS.cashier;
  }

  /** Return all role-based default rights */
  getAllDefaultRights(): Record<string, any> {
    return ROLE_RIGHTS;
  }

  /** Get the effective rights for a specific employee (defaults merged with overrides) */
  async getEmployeeRights(
    employeeId: string,
    storeId: string,
  ): Promise<Record<string, any>> {
    const emp = await this.findOneForStore(employeeId, storeId);
    const defaults = this.getDefaultRights(emp.role);
    return {
      employeeId: emp.id,
      ...defaults,
      maxDiscountPercent: emp.maxDiscountPercent ?? defaults.maxDiscountPercent,
      isOverride: false,
      updatedAt: emp.createdAt,
    };
  }
}
