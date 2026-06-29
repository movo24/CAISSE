import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { IntegrationEventEntity } from '../../database/entities/integration-event.entity';
import {
  buildSaleJournalLines,
  buildRefundJournalLines,
  reverseJournal,
  aggregateJournalByAccount,
  journalIsBalanced,
  journalTotals,
  journalToCsv,
  JournalLine,
} from './pre-accounting';
import {
  summarizeWorkforcePeriod,
  workforceToCsv,
  WorkforcePeriodSummary,
} from './social-preaccounting';
import { toEmployeePeriodInputs } from './payroll-adapter';
import { dayRangeUtc, inclusiveRangeUtc } from './journal-range';
import { TimewinService } from '../timewin/timewin.service';

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
  private readonly logger = new Logger(ComptamaxService.name);

  constructor(
    @InjectRepository(IntegrationEventEntity)
    private readonly events: Repository<IntegrationEventEntity>,
    private readonly timewin: TimewinService,
  ) {}

  /**
   * Social pre-accounting export (TimeWin→Comptamax). Fetches the TW24 monthly
   * payroll feed best-effort (degrades to an empty summary if TW24 is down),
   * normalizes it and consolidates HR variables. Read-only justificatif — NOT
   * real social journal entries (gate TD-INT-SOCIAL-ENTRIES).
   */
  async buildSocialExport(
    storeId: string,
    period: string,
  ): Promise<WorkforcePeriodSummary & { timewinReachable: boolean }> {
    let employees = [] as ReturnType<typeof toEmployeePeriodInputs>;
    let timewinReachable = true;
    try {
      employees = toEmployeePeriodInputs(await this.timewin.getMonthlyPayroll(storeId, period));
    } catch (e: any) {
      timewinReachable = false;
      this.logger.warn(`TimeWin24 payroll unreachable for ${storeId}/${period}: ${e?.message}`);
    }
    const summary = summarizeWorkforcePeriod({ period, storeId, employees });
    return { ...summary, timewinReachable };
  }

  async buildSocialExportCsv(storeId: string, period: string): Promise<string> {
    return workforceToCsv(await this.buildSocialExport(storeId, period));
  }

  async buildDayJournal(storeId: string, date: string): Promise<DayJournal> {
    const { start, end } = dayRangeUtc(date);
    const r = await this.aggregateRange(storeId, start, end);
    return { storeId, date, ...r };
  }

  /** Journal over an inclusive date range (period close), e.g. a month. */
  async buildJournalRange(
    storeId: string,
    from: string,
    to: string,
  ): Promise<DayJournal & { from: string; to: string }> {
    const { start, end } = inclusiveRangeUtc(from, to);
    const r = await this.aggregateRange(storeId, start, end);
    return { storeId, date: `${from}..${to}`, from, to, ...r };
  }

  async buildJournalRangeCsv(storeId: string, from: string, to: string): Promise<string> {
    return journalToCsv((await this.buildJournalRange(storeId, from, to)).lines);
  }

  private async aggregateRange(
    storeId: string,
    start: Date,
    end: Date,
  ): Promise<Omit<DayJournal, 'storeId' | 'date'>> {
    const rows = await this.events.find({
      where: {
        storeId,
        occurredAt: Between(start, end),
        type: In(['sale.completed', 'sale.voided', 'payment.captured', 'refund.created', 'credit_note.issued']),
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
            taxBreakdown: Array.isArray(p.taxBreakdown)
              ? p.taxBreakdown.map((b: any) => ({ rate: Number(b.rate), taxMinorUnits: Number(b.taxMinorUnits) }))
              : undefined,
          }),
        );
      } else if (e.type === 'sale.voided') {
        // Counter-entry of the sale (reverse debit/credit), booked on the void day.
        const saleLines = buildSaleJournalLines({
          ticketNumber: String(p.ticketNumber ?? e.aggregateId),
          totalMinorUnits: Number(p.totalMinorUnits) || 0,
          taxTotalMinorUnits: Number(p.taxTotalMinorUnits) || 0,
          payments: Array.isArray(p.payments)
            ? p.payments.map((x: any) => ({ method: String(x.method), amountMinorUnits: Number(x.amountMinorUnits) || 0 }))
            : [],
          taxBreakdown: Array.isArray(p.taxBreakdown)
            ? p.taxBreakdown.map((b: any) => ({ rate: Number(b.rate), taxMinorUnits: Number(b.taxMinorUnits) }))
            : undefined,
        });
        lines.push(...reverseJournal(saleLines, `Annulation ${p.ticketNumber ?? e.aggregateId}`));
      } else if (e.type === 'refund.created' || e.type === 'credit_note.issued') {
        if (p.origin !== 'return') continue; // gift cards are not sales reversals
        lines.push(
          ...buildRefundJournalLines({
            code: String(p.code ?? e.aggregateId),
            totalMinorUnits: Number(p.totalMinorUnits) || 0,
            taxTotalMinorUnits: 0,
            type: p.type === 'store_credit' ? 'store_credit' : 'refund',
            refundMethod: p.refundMethod ?? null,
            taxBreakdown: Array.isArray(p.taxBreakdown) // POS-INT-97
              ? p.taxBreakdown.map((b: any) => ({ rate: Number(b.rate), taxMinorUnits: Number(b.taxMinorUnits) }))
              : undefined,
          }),
        );
      }
    }

    const agg = aggregateJournalByAccount(lines);
    return {
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
