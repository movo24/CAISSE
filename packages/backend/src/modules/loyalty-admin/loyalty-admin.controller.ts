import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { LoyaltyRewardCycleEntity } from '../../database/entities/loyalty-reward-cycle.entity';
import { CouponEntity } from '../../database/entities/coupon.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { CustomerVisitEntity } from '../../database/entities/customer-visit.entity';
import { CouponService } from '../coupon/coupon.service';

@ApiTags('admin/loyalty')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager')
@Controller('admin/loyalty')
export class LoyaltyAdminController {
  constructor(
    @InjectRepository(LoyaltyRewardCycleEntity)
    private readonly cycleRepo: Repository<LoyaltyRewardCycleEntity>,
    @InjectRepository(CouponEntity)
    private readonly couponRepo: Repository<CouponEntity>,
    @InjectRepository(CustomerEntity)
    private readonly customerRepo: Repository<CustomerEntity>,
    @InjectRepository(CustomerVisitEntity)
    private readonly visitRepo: Repository<CustomerVisitEntity>,
    private readonly couponService: CouponService,
  ) {}

  // ── REWARD CYCLES ──────────────────────────────────────────────

  @Get('cycles')
  @ApiOperation({ summary: 'List reward cycles (global + per-store)' })
  async listCycles(@Query('storeId') storeId?: string) {
    if (storeId) {
      return this.cycleRepo.find({
        where: { storeId, active: true },
        order: { rank: 'ASC' },
      });
    }
    return this.cycleRepo.find({
      where: { storeId: IsNull(), active: true },
      order: { rank: 'ASC' },
    });
  }

  @Post('cycles')
  @Roles('admin')
  @ApiOperation({ summary: 'Create a reward cycle entry' })
  async createCycle(
    @Body()
    body: { storeId?: string; rank: number; discountPercent: number },
  ) {
    if (body.rank < 1 || body.rank > 50) {
      throw new BadRequestException('rank doit être entre 1 et 50');
    }
    if (body.discountPercent < 1 || body.discountPercent > 50) {
      throw new BadRequestException('discountPercent doit être entre 1 et 50');
    }
    const entity = this.cycleRepo.create({
      storeId: body.storeId ?? null,
      rank: body.rank,
      discountPercent: body.discountPercent,
      active: true,
    });
    return this.cycleRepo.save(entity);
  }

  @Patch('cycles/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a reward cycle entry' })
  async updateCycle(
    @Param('id') id: string,
    @Body() body: { discountPercent?: number; active?: boolean },
  ) {
    await this.cycleRepo.update(id, body);
    return this.cycleRepo.findOne({ where: { id } });
  }

  @Delete('cycles/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Soft-disable a reward cycle entry' })
  async deactivateCycle(@Param('id') id: string) {
    await this.cycleRepo.update(id, { active: false });
    return { success: true };
  }

  // ── COUPONS (manual issuance) ──────────────────────────────────

  @Post('coupons')
  @Roles('admin')
  @ApiOperation({ summary: 'Issue a manual coupon to a customer' })
  async issueManual(
    @Body()
    body: {
      customerId: string;
      discountPercent: number;
      validityDays?: number;
    },
  ) {
    const customer = await this.customerRepo.findOne({
      where: { id: body.customerId },
    });
    if (!customer) throw new BadRequestException('Client introuvable');

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + (body.validityDays ?? 30));

    const coupon = this.couponRepo.create({
      customerId: body.customerId,
      type: 'MANUAL',
      discountType: 'PERCENT',
      discountValue: body.discountPercent,
      status: 'AVAILABLE',
      validFrom: new Date(),
      validUntil,
    });
    return this.couponRepo.save(coupon);
  }

  // ── ANALYTICS ──────────────────────────────────────────────────

  @Get('analytics')
  @ApiOperation({ summary: 'Loyalty KPIs: customers, coupons, visits' })
  async analytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const from = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
    const to = endDate ? new Date(endDate) : new Date();

    const [
      totalCustomers,
      activeCustomers,
      couponsIssued,
      couponsRedeemed,
      visits,
    ] = await Promise.all([
      this.customerRepo.count({ where: { deletedAt: IsNull() } as any }),
      this.customerRepo
        .createQueryBuilder('c')
        .where('c.deletedAt IS NULL')
        .andWhere('c.lastVisitAt >= :from', { from })
        .getCount(),
      this.couponRepo
        .createQueryBuilder('cp')
        .where('cp.createdAt BETWEEN :from AND :to', { from, to })
        .getCount(),
      this.couponRepo
        .createQueryBuilder('cp')
        .where('cp.status = :status', { status: 'USED' })
        .andWhere('cp.usedAt BETWEEN :from AND :to', { from, to })
        .getCount(),
      this.visitRepo
        .createQueryBuilder('v')
        .where('v.visitedAt BETWEEN :from AND :to', { from, to })
        .getCount(),
    ]);

    return {
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      customers: {
        total: totalCustomers,
        active: activeCustomers,
      },
      coupons: {
        issued: couponsIssued,
        redeemed: couponsRedeemed,
        redemptionRate: couponsIssued > 0
          ? Math.round((couponsRedeemed / couponsIssued) * 100)
          : 0,
      },
      visits: visits,
    };
  }

  @Get('customers')
  @ApiOperation({ summary: 'List customers with loyalty stats' })
  async listCustomers(
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    const customers = await this.customerRepo
      .createQueryBuilder('c')
      .where('c.deletedAt IS NULL')
      .orderBy('c.visitCount', 'DESC')
      .addOrderBy('c.createdAt', 'DESC')
      .take(parseInt(limit, 10))
      .skip(parseInt(offset, 10))
      .getMany();

    return customers.map((c) => ({
      id: c.id,
      email: c.email,
      firstName: c.firstName,
      visitCount: c.visitCount,
      lastVisitAt: c.lastVisitAt?.toISOString() ?? null,
      preferredStoreId: c.preferredStoreId,
      createdAt: c.createdAt.toISOString(),
    }));
  }
}
