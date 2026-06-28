import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CustomerVisitEntity } from '../../database/entities/customer-visit.entity';
import { CustomerEntity } from '../../database/entities/customer.entity';
import { computeVisitFrequency } from './visit-frequency';
import { canAccessCustomer } from './customer-access';

@Injectable()
export class CustomerVisitsService {
  constructor(
    @InjectRepository(CustomerVisitEntity)
    private readonly visitRepo: Repository<CustomerVisitEntity>,
    @InjectRepository(CustomerEntity)
    private readonly customerRepo: Repository<CustomerEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Record a visit. Anti-duplicate: if same customer scanned same terminal
   * within 5 minutes, return the existing visit (no insert).
   */
  async recordVisit(input: {
    customerId: string;
    storeId: string;
    terminalId?: string;
    cashierEmployeeId?: string;
    ticketId?: string;
    purchaseAmountCents?: number;
  }): Promise<{ visitId: string; isDuplicate: boolean }> {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recent = await this.visitRepo
      .createQueryBuilder('v')
      .where('v.customerId = :customerId', { customerId: input.customerId })
      .andWhere('v.storeId = :storeId', { storeId: input.storeId })
      .andWhere('v.visitedAt > :since', { since: fiveMinAgo })
      .getOne();

    if (recent) {
      return { visitId: recent.id, isDuplicate: true };
    }

    return this.dataSource.transaction(async (mgr) => {
      const result = await mgr.insert(CustomerVisitEntity, {
        customerId: input.customerId,
        storeId: input.storeId,
        terminalId: input.terminalId ?? null,
        cashierEmployeeId: input.cashierEmployeeId ?? null,
        ticketId: input.ticketId ?? null,
        purchaseAmountCents: input.purchaseAmountCents ?? null,
        source: 'POS_SCAN',
      });

      await mgr.query(
        `UPDATE customers SET visit_count = visit_count + 1, last_visit_at = now() WHERE id = $1`,
        [input.customerId],
      );

      return {
        visitId: (result.identifiers[0] as any).id,
        isDuplicate: false,
      };
    });
  }

  async listForCustomer(customerId: string, limit = 50) {
    return this.visitRepo.find({
      where: { customerId },
      order: { visitedAt: 'DESC' },
      take: limit,
    });
  }

  /** Visit frequency analytics for a customer (count, interval, recency, segment). */
  async getFrequency(customerId: string, now: Date = new Date()) {
    const visits = await this.visitRepo.find({
      where: { customerId },
      order: { visitedAt: 'ASC' },
    });
    return computeVisitFrequency(
      visits.map((v) => v.visitedAt),
      now,
    );
  }

  /**
   * POS-094 — secured frequency read: fail-closed RBAC handled at the controller (manager+),
   * plus anti-IDOR ownership check here (customer must belong to the caller's store, admin bypass).
   */
  async getFrequencySecured(
    customerId: string,
    callerStoreId: string | null | undefined,
    role: string | null | undefined,
  ) {
    const customer = await this.customerRepo.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Client introuvable');
    if (!canAccessCustomer(customer.storeId, callerStoreId, role)) {
      throw new ForbiddenException('Accès au client refusé (hors périmètre magasin).');
    }
    return this.getFrequency(customerId);
  }
}
