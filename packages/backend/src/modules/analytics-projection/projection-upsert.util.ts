import { Logger } from '@nestjs/common';
import { ObjectLiteral, Repository, FindOptionsWhere } from 'typeorm';

/**
 * Guarded idempotent upsert for the analytics projection — makes `computed_at`
 * monotonicity STRUCTURAL (not dependent on the cron always passing a fresh clock).
 *
 * Per-row guard on the keyed row:
 *   - now >= existing.computed_at → replace (a same-ms re-run still replaces → idempotent),
 *   - now <  existing.computed_at → REJECT and WARN (clock/concurrency anomaly), keeping
 *     the fresher row. The rejection is NOT silent — a stale write is a signal to surface.
 */
export async function guardedProjectionUpsert<T extends ObjectLiteral>(
  repo: Repository<T>,
  where: FindOptionsWhere<T>,
  row: Record<string, unknown> & { computedAt: Date },
  now: Date,
  logger: Logger,
  label: string,
): Promise<'written' | 'rejected'> {
  const existing = await repo.findOne({ where });
  const existingAt = existing ? new Date((existing as any).computedAt).getTime() : null;

  if (existingAt !== null && existingAt > now.getTime()) {
    logger.warn(
      `${label}: refused a STALE refresh (now=${now.toISOString()} < existing computed_at=${(existing as any).computedAt}) ` +
        `— clock/concurrency anomaly; kept the fresher row`,
    );
    return 'rejected';
  }

  await repo.delete(where);
  await repo.insert(row as any);
  return 'written';
}
