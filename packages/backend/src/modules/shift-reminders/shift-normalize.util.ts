/**
 * Pure, defensive normalization of TimeWin24's loosely-typed today-shifts feed.
 *
 * Extracted from ShiftReminderService so other modules (pos-session shift
 * compliance) reuse ONE canonical parser without a module dependency. The feed
 * shape is external and ambiguous — every field is parsed best-effort and a
 * record missing the minimum (id + start) is skipped, never guessed.
 *
 * `endsAt` and `employeeId` are OPTIONAL: they only exist when TW24 provides
 * them. Downstream consumers must treat their absence as "unknowable" and emit
 * NOTHING (probant-only doctrine — no approximate scoring).
 */

/** A shift normalized from whatever shape TimeWin24's today-shifts feed returns. */
export interface NormalizedShift {
  id: string;
  employeeName: string;
  startsAt: Date;
  /** Fin de shift — présente uniquement si le feed TW24 la fournit. */
  endsAt?: Date | null;
  /** Identité employé TW24 — présente uniquement si le feed la fournit. */
  employeeId?: string | null;
  phone?: string;
  email?: string;
}

function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  const d = new Date(raw as any);
  return isNaN(d.getTime()) ? null : d;
}

/** Defensively map TW24's loosely-typed shift records into NormalizedShift[]. */
export function normalizeShiftRecords(raw: unknown): NormalizedShift[] {
  const list: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.shifts)
      ? (raw as any).shifts
      : [];
  const out: NormalizedShift[] = [];
  for (const r of list) {
    const id = r?.id ?? r?.shiftId ?? r?.shift_id;
    const startsAt = parseDate(r?.startsAt ?? r?.startAt ?? r?.start ?? r?.startTime ?? r?.start_at);
    if (!id || !startsAt) continue;
    const endsAt = parseDate(r?.endsAt ?? r?.endAt ?? r?.end ?? r?.endTime ?? r?.end_at);
    const employeeIdRaw = r?.employeeId ?? r?.employee_id ?? r?.empId ?? r?.emp_id;
    out.push({
      id: String(id),
      employeeName: r?.employeeName ?? r?.employee_name ?? r?.fullName ?? 'Employé',
      startsAt,
      endsAt: endsAt ?? null,
      employeeId: employeeIdRaw != null ? String(employeeIdRaw) : null,
      phone: r?.phone ?? r?.employeePhone ?? r?.employee_phone ?? undefined,
      email: r?.email ?? r?.employeeEmail ?? r?.employee_email ?? undefined,
    });
  }
  return out;
}

/**
 * Le shift TERMINÉ de cet employé, s'il est PROUVABLE — sinon null.
 *
 * Probant uniquement :
 *  - match strict sur `employeeId` (jamais sur le nom, ambigu) ;
 *  - `endsAt` parsée ET strictement passée ;
 *  - si l'employé a AUSSI un shift en cours ou à venir aujourd'hui (coupure,
 *    double service), on retourne null : travailler entre deux shifts n'est
 *    pas une anomalie.
 * Toute donnée absente/ambiguë → null (aucune alerte approximative).
 */
export function findEndedShiftFor(
  shifts: NormalizedShift[],
  employeeId: string,
  now: Date,
): NormalizedShift | null {
  if (!employeeId) return null;
  const mine = shifts.filter((s) => s.employeeId && s.employeeId === employeeId);
  if (mine.length === 0) return null;
  // Un shift sans fin parsée rend la situation inconnaissable → null.
  if (mine.some((s) => !s.endsAt)) return null;
  // Un shift encore en cours ou à venir → pas d'anomalie.
  const stillOpen = mine.some((s) => s.endsAt!.getTime() > now.getTime());
  if (stillOpen) return null;
  // Tous terminés → le plus récent.
  return mine.reduce((latest, s) => (s.endsAt!.getTime() > latest.endsAt!.getTime() ? s : latest));
}
