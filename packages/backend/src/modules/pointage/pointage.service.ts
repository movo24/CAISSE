import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { PointageEntryEntity } from '../../database/entities/pointage-entry.entity';

@Injectable()
export class PointageService {
  constructor(
    @InjectRepository(PointageEntryEntity)
    private readonly repo: Repository<PointageEntryEntity>,
  ) {}

  // ── Record a punch ──
  async recordPunch(storeId: string, data: any): Promise<PointageEntryEntity> {
    const entry = this.repo.create({
      id: data.id || `punch-${Date.now()}`,
      storeId,
      employeeId: data.employeeId,
      employeeName: data.employeeName,
      type: data.type,
      timestamp: new Date(data.timestamp),
      source: data.source || 'manual',
    });
    return this.repo.save(entry);
  }

  // ── Today's punches for an employee ──
  async getTodayPunches(storeId: string, employeeId: string): Promise<PointageEntryEntity[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.repo.find({
      where: {
        storeId,
        employeeId,
        timestamp: Between(today, tomorrow),
      },
      order: { timestamp: 'ASC' },
    });
  }

  // ── List punches with filters ──
  async list(storeId: string, query: { date?: string; employeeId?: string }): Promise<PointageEntryEntity[]> {
    const qb = this.repo.createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .orderBy('p.timestamp', 'DESC');

    if (query.employeeId) {
      qb.andWhere('p.employee_id = :employeeId', { employeeId: query.employeeId });
    }

    if (query.date) {
      const day = new Date(query.date);
      day.setHours(0, 0, 0, 0);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      qb.andWhere('p.timestamp >= :start AND p.timestamp < :end', { start: day, end: next });
    }

    return qb.limit(500).getMany();
  }

  // ── Live status: currently clocked-in employees ──
  async liveStatus(storeId: string): Promise<any[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const punches = await this.repo.find({
      where: { storeId, timestamp: MoreThanOrEqual(today) },
      order: { timestamp: 'ASC' },
    });

    // Group by employee and find who is currently clocked in
    const byEmployee = new Map<string, PointageEntryEntity[]>();
    for (const p of punches) {
      if (!byEmployee.has(p.employeeId)) byEmployee.set(p.employeeId, []);
      byEmployee.get(p.employeeId)!.push(p);
    }

    const live: any[] = [];
    const now = Date.now();

    for (const [empId, empPunches] of byEmployee) {
      const last = empPunches[empPunches.length - 1];
      if (last.type === 'clock_out') continue; // Already clocked out

      const clockIn = empPunches.find(p => p.type === 'clock_in');
      if (!clockIn) continue;

      const isOnBreak = last.type === 'break_start';
      const durationMinutes = Math.round((now - new Date(clockIn.timestamp).getTime()) / 60000);

      live.push({
        id: empId,
        name: last.employeeName,
        clockInAt: clockIn.timestamp,
        isOnBreak,
        durationMinutes,
      });
    }

    return live;
  }

  // ── Daily summary with anomaly detection ──
  async summary(storeId: string, query: { employeeId?: string; startDate: string; endDate: string }): Promise<any[]> {
    const start = new Date(query.startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(query.endDate);
    end.setHours(23, 59, 59, 999);

    const qb = this.repo.createQueryBuilder('p')
      .where('p.store_id = :storeId', { storeId })
      .andWhere('p.timestamp >= :start AND p.timestamp <= :end', { start, end })
      .orderBy('p.timestamp', 'ASC');

    if (query.employeeId) {
      qb.andWhere('p.employee_id = :employeeId', { employeeId: query.employeeId });
    }

    const punches = await qb.getMany();

    // Group by employee + date
    const groups = new Map<string, PointageEntryEntity[]>();
    for (const p of punches) {
      const dateStr = new Date(p.timestamp).toISOString().split('T')[0];
      const key = `${p.employeeId}|${dateStr}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    const summaries: any[] = [];

    for (const [key, dayPunches] of groups) {
      const [employeeId, date] = key.split('|');
      const name = dayPunches[0].employeeName;

      const clockIn = dayPunches.find(p => p.type === 'clock_in');
      const clockOut = [...dayPunches].reverse().find(p => p.type === 'clock_out');

      let totalMinutes = 0;
      let breakMinutes = 0;

      if (clockIn && clockOut) {
        totalMinutes = Math.round(
          (new Date(clockOut.timestamp).getTime() - new Date(clockIn.timestamp).getTime()) / 60000,
        );
      }

      // Calculate break time
      let breakStart: Date | null = null;
      for (const p of dayPunches) {
        if (p.type === 'break_start') breakStart = new Date(p.timestamp);
        if (p.type === 'break_end' && breakStart) {
          breakMinutes += Math.round((new Date(p.timestamp).getTime() - breakStart.getTime()) / 60000);
          breakStart = null;
        }
      }

      // Anomaly detection
      const anomalies: string[] = [];
      if (!clockOut && clockIn) anomalies.push('Sortie manquante');
      if (!clockIn) anomalies.push('Entrée manquante');
      if (breakMinutes > 120) anomalies.push('Pause excessive (>2h)');
      if (totalMinutes > 600) anomalies.push('Journée excessive (>10h)');
      if (breakStart) anomalies.push('Pause non terminée');

      summaries.push({
        employeeId,
        employeeName: name,
        date,
        clockIn: clockIn ? clockIn.timestamp : null,
        clockOut: clockOut ? clockOut.timestamp : null,
        totalMinutes,
        breakMinutes,
        netMinutes: Math.max(0, totalMinutes - breakMinutes),
        anomalies,
      });
    }

    return summaries;
  }

  // ── Anomalies for a store ──
  async anomalies(storeId: string, date?: string): Promise<any[]> {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const summaries = await this.summary(storeId, {
      startDate: targetDate,
      endDate: targetDate,
    });

    return summaries.filter(s => s.anomalies.length > 0);
  }
}
