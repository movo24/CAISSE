/* ═══════════════════════════════════════════════════════════════
   PAYROLL CALCULATOR — Fonctions pures de calcul paie
   Heures travaillées, heures sup (>35h), brut, cotisations
   Conforme droit du travail français simplifié
   ═══════════════════════════════════════════════════════════════ */

// ── Types ──

export interface EmployeePayConfig {
  employeeId: string;
  employeeName: string;
  role: string;
  hourlyRateGross: number;    // centimes/heure (ex: 1250 = 12,50€/h)
  contractHoursWeek: number;  // heures hebdo contrat (ex: 35)
  overtimeRate25: number;     // Taux majoration 25% (heures 36-43) — en fraction (1.25)
  overtimeRate50: number;     // Taux majoration 50% (heures 44+) — en fraction (1.50)
}

export interface DailyWorkRecord {
  date: string;               // YYYY-MM-DD
  clockIn: string;            // HH:mm
  clockOut: string;           // HH:mm
  breakMinutes: number;
  plannedStart?: string;      // HH:mm (from planning)
  plannedEnd?: string;        // HH:mm (from planning)
}

export interface WeekSummary {
  weekStart: string;          // YYYY-MM-DD (lundi)
  totalWorkedMinutes: number;
  totalWorkedHours: number;
  regularHours: number;       // Heures normales (≤ seuil légal)
  overtimeHours25: number;    // Heures sup 25% (36-43h)
  overtimeHours50: number;    // Heures sup 50% (44h+)
  dailyRecords: DailyWorkRecord[];
}

export interface MonthPayroll {
  employeeId: string;
  employeeName: string;
  role: string;
  month: string;              // YYYY-MM
  // Heures
  totalWorkedHours: number;
  regularHours: number;
  overtimeHours25: number;
  overtimeHours50: number;
  totalContractHours: number;  // heures contrat du mois
  daysWorked: number;
  // Montants en centimes
  grossRegular: number;
  grossOvertime25: number;
  grossOvertime50: number;
  grossTotal: number;
  // Cotisations simplifiées
  employeeSocialCharges: number;   // ~22% du brut
  employerSocialCharges: number;   // ~42% du brut
  netBeforeTax: number;
  // Weeks
  weeks: WeekSummary[];
}

// ── Constants ──

const LEGAL_WEEKLY_HOURS = 35;
const OVERTIME_25_THRESHOLD = 43;  // De 36h à 43h = +25%
// Au-delà de 43h = +50%

const EMPLOYEE_SOCIAL_RATE = 0.22;   // 22% charges salariales simplifiées
const EMPLOYER_SOCIAL_RATE = 0.42;   // 42% charges patronales simplifiées

// ── Helpers ──

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHours(m: number): number {
  return Math.round((m / 60) * 100) / 100;
}

// ── Core calculation functions ──

/**
 * Calcule les heures travaillées pour une journée
 */
export function calculateDailyHours(record: DailyWorkRecord): number {
  const start = timeToMinutes(record.clockIn);
  const end = timeToMinutes(record.clockOut);
  const worked = Math.max(0, end - start - record.breakMinutes);
  return minutesToHours(worked);
}

/**
 * Calcule le résumé d'une semaine avec heures sup
 */
export function calculateWeekSummary(
  weekStart: string,
  records: DailyWorkRecord[],
  contractHoursWeek: number = LEGAL_WEEKLY_HOURS,
): WeekSummary {
  const totalMinutes = records.reduce((sum, r) => {
    const start = timeToMinutes(r.clockIn);
    const end = timeToMinutes(r.clockOut);
    return sum + Math.max(0, end - start - r.breakMinutes);
  }, 0);

  const totalHours = minutesToHours(totalMinutes);
  const regularHours = Math.min(totalHours, contractHoursWeek);

  let overtimeHours25 = 0;
  let overtimeHours50 = 0;

  if (totalHours > contractHoursWeek) {
    const overtime = totalHours - contractHoursWeek;
    const ot25Limit = OVERTIME_25_THRESHOLD - contractHoursWeek;
    overtimeHours25 = Math.min(overtime, ot25Limit);
    overtimeHours50 = Math.max(0, overtime - ot25Limit);
  }

  return {
    weekStart,
    totalWorkedMinutes: totalMinutes,
    totalWorkedHours: totalHours,
    regularHours,
    overtimeHours25: Math.round(overtimeHours25 * 100) / 100,
    overtimeHours50: Math.round(overtimeHours50 * 100) / 100,
    dailyRecords: records,
  };
}

/**
 * Calcule la fiche de paie mensuelle complète
 */
export function calculateMonthPayroll(
  config: EmployeePayConfig,
  weekSummaries: WeekSummary[],
  month: string,
): MonthPayroll {
  let totalWorkedHours = 0;
  let regularHours = 0;
  let overtimeHours25 = 0;
  let overtimeHours50 = 0;
  let daysWorked = 0;

  for (const week of weekSummaries) {
    totalWorkedHours += week.totalWorkedHours;
    regularHours += week.regularHours;
    overtimeHours25 += week.overtimeHours25;
    overtimeHours50 += week.overtimeHours50;
    daysWorked += week.dailyRecords.length;
  }

  // Arrondir
  totalWorkedHours = Math.round(totalWorkedHours * 100) / 100;
  regularHours = Math.round(regularHours * 100) / 100;
  overtimeHours25 = Math.round(overtimeHours25 * 100) / 100;
  overtimeHours50 = Math.round(overtimeHours50 * 100) / 100;

  // Heures contrat du mois (~4.33 semaines)
  const weeksInMonth = weekSummaries.length || 4.33;
  const totalContractHours = Math.round(config.contractHoursWeek * weeksInMonth * 100) / 100;

  // Montants bruts (centimes)
  const grossRegular = Math.round(regularHours * config.hourlyRateGross);
  const grossOvertime25 = Math.round(overtimeHours25 * config.hourlyRateGross * config.overtimeRate25);
  const grossOvertime50 = Math.round(overtimeHours50 * config.hourlyRateGross * config.overtimeRate50);
  const grossTotal = grossRegular + grossOvertime25 + grossOvertime50;

  // Cotisations
  const employeeSocialCharges = Math.round(grossTotal * EMPLOYEE_SOCIAL_RATE);
  const employerSocialCharges = Math.round(grossTotal * EMPLOYER_SOCIAL_RATE);
  const netBeforeTax = grossTotal - employeeSocialCharges;

  return {
    employeeId: config.employeeId,
    employeeName: config.employeeName,
    role: config.role,
    month,
    totalWorkedHours,
    regularHours,
    overtimeHours25,
    overtimeHours50,
    totalContractHours,
    daysWorked,
    grossRegular,
    grossOvertime25,
    grossOvertime50,
    grossTotal,
    employeeSocialCharges,
    employerSocialCharges,
    netBeforeTax,
    weeks: weekSummaries,
  };
}

/**
 * Formate un montant en centimes vers "1 234,56 €"
 */
export function formatCurrency(minorUnits: number): string {
  return (minorUnits / 100)
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20ac';
}

/**
 * Formate les heures en "35h00" ou "2h30"
 */
export function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}
