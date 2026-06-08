import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CustomerVisitEntity } from '../../database/entities/customer-visit.entity';

@Injectable()
export class CustomerVisitsService {
  constructor(
    @InjectRepository(CustomerVisitEntity)
    private readonly visitRepo: Repository<CustomerVisitEntity>,
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
}
