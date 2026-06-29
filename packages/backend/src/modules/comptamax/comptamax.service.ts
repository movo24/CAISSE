import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import {
  buildSaleJournalLines,
  buildRefundJournalLines,
  aggregateJournalByAccount,
  journalIsBalanced,
  journalTotals,
  journalToCsv,
  JournalLine,
} from './pre-accounting';

export interface DayJournal {
  storeId: string;
  date: string;
  lines: JournalLine[];
  totals: { debit: number; credit: number };
  balanced: boolean;
  eventCount: number;
}

/**
 * POS → Comptamax24 pre-accounting reader.
 * Builds the daily double-entry journal from the integration outbox (sales,
 * refunds, credit notes). Read-only, tenant-scoped, out-of-band: it never touches
 * the caisse path. Gift-card issuances (origin gift_card) are NOT booked as sales
 * reversals here (they are a liability, handled separately).
 */
@Injectable()
export class ComptamaxService {
  constructor(
    @InjectRepository(IntegrationEventEntity)
    private readonly events: Repository<IntegrationEventEntity>,
  ) {}

  async buildDayJournal(storeId: string, date: string): Promise<DayJournal> {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const rows = await this.events.find({
      where: {
        storeId,
        occurredAt: Between(start, end),
        type: In(['sale.completed', 'payment.captured', 'refund.created', 'credit_note.issued']),
      },
      order: { occurredAt: 'ASC' },
    });

    // payments grouped by sale aggregate (payment.captured carries the amounts)
    const paymentsBySale = new Map<string, { method: string; amountMinorUnits: number }[]>();
    for (const e of rows) {
      if (e.type !== 'payment.captured') continue;
      const p = e.payload as any;
      const arr = paymentsBySale.get(e.aggregateId) ?? [];
      arr.push({ method: String(p.method), amountMinorUnits: Number(p.amountMinorUnits) || 0 });
      paymentsBySale.set(e.aggregateId, arr);
    }

    const lines: JournalLine[] = [];
    for (const e of rows) {
      const p = e.payload as any;
      if (e.type === 'sale.completed') {
        lines.push(
          ...buildSaleJournalLines({
            ticketNumber: String(p.ticketNumber ?? e.aggregateId),
            totalMinorUnits: Number(p.totalMinorUnits) || 0,
            taxTotalMinorUnits: Number(p.taxTotalMinorUnits) || 0,
            payments: paymentsBySale.get(e.aggregateId) ?? [],
          }),
        );
      } else if (e.type === 'refund.created' || e.type === 'credit_note.issued') {
        if (p.origin !== 'return') continue; // gift cards are not sales reversals
        lines.push(
          ...buildRefundJournalLines({
            code: String(p.code ?? e.aggregateId),
            totalMinorUnits: Number(p.totalMinorUnits) || 0,
            taxTotalMinorUnits: 0, // refund tax split not carried in payload yet (TD-INT-REFUND-TAX)
            type: p.type === 'store_credit' ? 'store_credit' : 'refund',
            refundMethod: p.refundMethod ?? null,
          }),
        );
      }
    }

    const agg = aggregateJournalByAccount(lines);
    return {
      storeId,
      date,
      lines: agg,
      totals: journalTotals(agg),
      balanced: journalIsBalanced(agg),
      eventCount: rows.length,
    };
  }

  async buildDayJournalCsv(storeId: string, date: string): Promise<string> {
    const journal = await this.buildDayJournal(storeId, date);
    return journalToCsv(journal.lines);
  }
}
