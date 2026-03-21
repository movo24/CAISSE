import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PayrollConfigEntity } from '../../database/entities/payroll-config.entity';
import { PointageEntryEntity } from '../../database/entities/pointage-entry.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';

const LEGAL_WEEKLY_HOURS = 35;
const OVERTIME_25_LIMIT = 43; // hours 36-43: +25%
const EMPLOYEE_SOCIAL_RATE = 0.22;
const EMPLOYER_SOCIAL_RATE = 0.42;

@Injectable()
export class PayrollService {
  constructor(
    @InjectRepository(PayrollConfigEntity)
    private readonly configRepo: Repository<PayrollConfigEntity>,
    @InjectRepository(PointageEntryEntity)
    private readonly pointageRepo: Repository<PointageEntryEntity>,
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepo: Repository<EmployeeEntity>,
  ) {}

  // ── Get or create payroll config for employee ──
  private async getConfig(storeId: string, employeeId: string): Promise<PayrollConfigEntity> {
    let cfg = await this.configRepo.findOne({ where: { storeId, employeeId } });
    if (!cfg) {
      cfg = this.configRepo.create({
        storeId,
        employeeId,
        hourlyRateGross: 1200, // 12.00€
        contractHoursWeek: 35,
      });
      cfg = await this.configRepo.save(cfg);
    }
    return cfg;
  }

  // ── Update hourly rate ──
  async updateRate(storeId: string, employeeId: string, data: { hourlyRateGross: number; contractHoursWeek: number }) {
    let cfg = await this.getConfig(storeId, employeeId);
    cfg.hourlyRateGross = data.hourlyRateGross;
    cfg.contractHoursWeek = data.contractHoursWeek;
    return this.configRepo.save(cfg);
  }

  // ── Calculate hours worked from pointage entries ──
  private calculateDailyHours(punches: PointageEntryEntity[]): { totalMinutes: number; breakMinutes: number } {
    let totalMinutes = 0;
    let breakMinutes = 0;

    const clockIn = punches.find(p => p.type === 'clock_in');
    const clockOut = [...punches].reverse().find(p => p.type === 'clock_out');

    if (clockIn && clockOut) {
      totalMinutes = Math.round(
        (new Date(clockOut.timestamp).getTime() - new Date(clockIn.timestamp).getTime()) / 60000,
      );
    }

    let breakStart: Date | null = null;
    for (const p of punches) {
      if (p.type === 'break_start') breakStart = new Date(p.timestamp);
      if (p.type === 'break_end' && breakStart) {
        breakMinutes += Math.round((new Date(p.timestamp).getTime() - breakStart.getTime()) / 60000);
        breakStart = null;
      }
    }

    return { totalMinutes, breakMinutes };
  }

  // ── Monthly payroll summary ──
  async getMonthSummary(storeId: string, month: string): Promise<any[]> {
    const employees = await this.employeeRepo.find({ where: { storeId, isActive: true } });
    const results: any[] = [];

    for (const emp of employees) {
      const payslip = await this.getEmployeePayslip(storeId, emp.id, month);
      results.push(payslip);
    }

    return results;
  }

  // ── Employee payslip for a month ──
  async getEmployeePayslip(storeId: string, employeeId: string, month: string): Promise<any> {
    const cfg = await this.getConfig(storeId, employeeId);
    const emp = await this.employeeRepo.findOne({ where: { id: employeeId } });

    // Parse month (YYYY-MM)
    const [year, mon] = month.split('-').map(Number);
    const monthStart = new Date(year, mon - 1, 1);
    const monthEnd = new Date(year, mon, 0, 23, 59, 59);

    // Get all punches for the month
    const punches = await this.pointageRepo
      .createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.employee_id = :employeeId', { employeeId })
      .andWhere('p.timestamp >= :start AND p.timestamp <= :end', { start: monthStart, end: monthEnd })
      .orderBy('p.timestamp', 'ASC')
      .getMany();

    // Group by date
    const byDate = new Map<string, PointageEntryEntity[]>();
    for (const p of punches) {
      const d = new Date(p.timestamp).toISOString().split('T')[0];
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(p);
    }

    let totalWorkedMinutes = 0;
    let daysWorked = 0;
    const weeklyHours: number[] = [0, 0, 0, 0, 0]; // up to 5 weeks

    for (const [dateStr, dayPunches] of byDate) {
      const { totalMinutes, breakMinutes } = this.calculateDailyHours(dayPunches);
      const netMinutes = Math.max(0, totalMinutes - breakMinutes);
      totalWorkedMinutes += netMinutes;
      daysWorked++;

      // Determine which week of the month
      const dayOfMonth = new Date(dateStr).getDate();
      const weekIndex = Math.min(4, Math.floor((dayOfMonth - 1) / 7));
      weeklyHours[weekIndex] += netMinutes / 60;
    }

    const totalWorkedHours = totalWorkedMinutes / 60;

    // Calculate overtime
    let regularHours = 0;
    let overtimeHours25 = 0;
    let overtimeHours50 = 0;

    for (const weekHrs of weeklyHours) {
      if (weekHrs <= LEGAL_WEEKLY_HOURS) {
        regularHours += weekHrs;
      } else if (weekHrs <= OVERTIME_25_LIMIT) {
        regularHours += LEGAL_WEEKLY_HOURS;
        overtimeHours25 += weekHrs - LEGAL_WEEKLY_HOURS;
      } else {
        regularHours += LEGAL_WEEKLY_HOURS;
        overtimeHours25 += OVERTIME_25_LIMIT - LEGAL_WEEKLY_HOURS;
        overtimeHours50 += weekHrs - OVERTIME_25_LIMIT;
      }
    }

    const ratePerHour = cfg.hourlyRateGross; // centimes
    const grossRegular = Math.round(regularHours * ratePerHour);
    const grossOvertime25 = Math.round(overtimeHours25 * ratePerHour * 1.25);
    const grossOvertime50 = Math.round(overtimeHours50 * ratePerHour * 1.50);
    const grossTotal = grossRegular + grossOvertime25 + grossOvertime50;

    const employeeSocialCharges = Math.round(grossTotal * EMPLOYEE_SOCIAL_RATE);
    const employerSocialCharges = Math.round(grossTotal * EMPLOYER_SOCIAL_RATE);
    const netBeforeTax = grossTotal - employeeSocialCharges;

    return {
      employeeId,
      employeeName: emp ? `${emp.firstName} ${emp.lastName}` : employeeId,
      role: emp?.role || 'cashier',
      month,
      daysWorked,
      totalWorkedHours: Math.round(totalWorkedHours * 100) / 100,
      regularHours: Math.round(regularHours * 100) / 100,
      overtimeHours25: Math.round(overtimeHours25 * 100) / 100,
      overtimeHours50: Math.round(overtimeHours50 * 100) / 100,
      hourlyRateGross: cfg.hourlyRateGross,
      contractHoursWeek: cfg.contractHoursWeek,
      grossRegular,
      grossOvertime25,
      grossOvertime50,
      grossTotal,
      employeeSocialCharges,
      netBeforeTax,
      employerSocialCharges,
      weeks: weeklyHours.map((h, i) => ({
        week: i + 1,
        hoursWorked: Math.round(h * 100) / 100,
        regularHours: Math.min(h, LEGAL_WEEKLY_HOURS),
        overtimeHours: Math.max(0, h - LEGAL_WEEKLY_HOURS),
      })),
    };
  }

  // ── Export CSV ──
  async exportCSV(storeId: string, month: string): Promise<string> {
    const payrolls = await this.getMonthSummary(storeId, month);

    const headers = [
      'Employé', 'Rôle', 'Mois', 'Jours travaillés', 'Heures totales',
      'Heures normales', 'Heures sup 25%', 'Heures sup 50%',
      'Taux horaire (€)', 'Brut normal (€)', 'Brut sup 25% (€)', 'Brut sup 50% (€)',
      'Brut total (€)', 'Charges salariales (€)', 'Net avant impôt (€)', 'Charges patronales (€)',
    ];

    const rows = payrolls.map(p => [
      p.employeeName, p.role, p.month, p.daysWorked, p.totalWorkedHours,
      p.regularHours, p.overtimeHours25, p.overtimeHours50,
      (p.hourlyRateGross / 100).toFixed(2),
      (p.grossRegular / 100).toFixed(2), (p.grossOvertime25 / 100).toFixed(2), (p.grossOvertime50 / 100).toFixed(2),
      (p.grossTotal / 100).toFixed(2), (p.employeeSocialCharges / 100).toFixed(2),
      (p.netBeforeTax / 100).toFixed(2), (p.employerSocialCharges / 100).toFixed(2),
    ]);

    const BOM = '\uFEFF';
    const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    return csv;
  }
}
