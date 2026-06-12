import { MigrationInterface, QueryRunner } from 'typeorm';

export const CHAIN_GENESIS = '0'.repeat(64);

export interface ChainRow {
  id: string;
  prev: string | null;
  cur: string | null;
}

/**
 * Pure chain walk + structural integrity audit (no DB) — exported so the STOP
 * predicates are unit-testable deterministically. Given all rows of ONE
 * (store, chain), returns the rows in chain order paired with a 1-based seq, or
 * THROWS on any structural break (a pre-existing fork surfaced → incident).
 *
 * STOP predicates (= "casse/ambigu", ADR-012 AMENDMENT-1):
 *   (6) NULL prev/cur          — unchained legacy row (credit_notes is nullable);
 *   (4) duplicate `cur`        — ambiguous head (also guarantees termination);
 *   (1) 0 genesis with rows    — rootless chain;
 *   (2) ≥2 genesis             — multiple roots / fork;
 *   (3) ≥2 successors of a node — fork;
 *   (5) orphans                — rows unreachable from genesis;
 *   + explicit visited-set     — clean STOP on a cycle instead of looping.
 *
 * Scope: STRUCTURAL only (root / fork / orphan / link). It does NOT recompute
 * payload hashes — that deep re-validation is `fiscal:verify-z` (layer 3).
 */
export function walkChainSequence(
  label: string,
  rows: ChainRow[],
): Array<{ id: string; seq: number }> {
  if (rows.length === 0) return [];

  // (6) NULL-hash row = legacy unchained (credit_notes columns are nullable).
  for (const r of rows) {
    if (r.cur === null || r.prev === null) {
      throw new Error(
        `${label}: row ${r.id} has a NULL hash (prev=${r.prev}, current=${r.cur}) ` +
          `— unchained legacy row, refusing to backfill. INCIDENT.`,
      );
    }
  }

  // (4) duplicate `current` — ambiguous head; also bounds the walk.
  const byCur = new Map<string, string>();
  for (const r of rows) {
    const cur = r.cur as string;
    if (byCur.has(cur)) {
      throw new Error(
        `${label}: duplicate hash_chain_current ${cur} (rows ${byCur.get(cur)}, ` +
          `${r.id}) — ambiguous chain head. INCIDENT: pre-existing fork.`,
      );
    }
    byCur.set(cur, r.id);
  }

  // successors index: prev → [rows]
  const byPrev = new Map<string, Array<{ id: string; cur: string }>>();
  for (const r of rows) {
    const prev = r.prev as string;
    if (!byPrev.has(prev)) byPrev.set(prev, []);
    byPrev.get(prev)!.push({ id: r.id, cur: r.cur as string });
  }

  // (1)/(2) genesis = rows whose prev = '0'×64.
  const genesis = byPrev.get(CHAIN_GENESIS) ?? [];
  if (genesis.length === 0) {
    throw new Error(
      `${label}: ${rows.length} row(s) but NO genesis (prev='0'×64) — rootless ` +
        `chain. INCIDENT.`,
    );
  }
  if (genesis.length > 1) {
    throw new Error(
      `${label}: ${genesis.length} genesis rows (${genesis
        .map((g) => g.id)
        .join(', ')}) — multiple roots / fork. INCIDENT.`,
    );
  }

  // Walk from genesis.
  const visited = new Set<string>();
  const out: Array<{ id: string; seq: number }> = [];
  let node: { id: string; cur: string } | null = genesis[0];
  let seq = 0;
  while (node) {
    if (visited.has(node.id)) {
      throw new Error(`${label}: cycle at row ${node.id}. INCIDENT.`);
    }
    visited.add(node.id);
    out.push({ id: node.id, seq: ++seq });

    const succ: Array<{ id: string; cur: string }> = byPrev.get(node.cur) ?? [];
    if (succ.length > 1) {
      throw new Error(
        `${label}: fork — ${succ.length} successors of ${node.cur} (rows ` +
          `${succ.map((s) => s.id).join(', ')}). INCIDENT.`,
      );
    }
    node = succ.length === 1 ? succ[0] : null;
  }

  // (5) orphans: rows not reachable from genesis.
  if (visited.size !== rows.length) {
    const orphans = rows.filter((r) => !visited.has(r.id)).map((r) => r.id);
    throw new Error(
      `${label}: ${orphans.length} orphan row(s) not reachable from genesis ` +
        `(${orphans.slice(0, 5).join(', ')}${
          orphans.length > 5 ? ', …' : ''
        }). INCIDENT: broken chain.`,
    );
  }

  return out;
}

/**
 * Curseurs fiscaux monotones par magasin sur les deux chaînes CORRECTIVES —
 * `credit_notes.credit_note_seq` et `fiscal_journal.journal_seq` (ADR-012,
 * AMENDMENT-1, couche 0).
 *
 * Pourquoi : contrairement aux ventes (qui headent leur chaîne de hash sur
 * `ticket_number`, monotone), credit_notes et fiscal_journal headent sur
 * `ORDER BY created_at DESC` (returns.service.ts:149/293, sales.service.ts:1014).
 * `created_at` est de l'horloge murale : tête NON-DÉTERMINISTE sur une égalité à
 * la milliseconde, INVERSÉE sur un saut NTP arrière → fork latent PRÉSENT (pas un
 * risque à 1M comme les ventes). Le z_seal a besoin d'un curseur lock-sérialisé
 * pour border sa fenêtre de clôture sans race ; ces colonnes le fournissent, et
 * réparent le fork latent du même geste.
 *
 * BACKFILL PAR WALK, JAMAIS PAR created_at (ADR-012 AMENDMENT-1) — `created_at`
 * est exactement la chose non-fiable qu'on retire ; trier le backfill dessus
 * graverait un ordre faux sur un tie. On DÉROULE la chaîne de hash depuis genesis
 * (`prev = '0'×64`, suivre `prev = current` du parent) et on assigne seq dans
 * l'ordre de chaîne. Le walk EST l'audit d'intégrité STRUCTUREL : racine, fork,
 * orphelin, lien — il N'EST PAS un recompute de payload (ça, c'est le job de
 * fiscal:verify-z, couche 3). Toute cassure/ambiguïté = fork préexistant surfacé
 * → STOP, incident (pattern du null-check 1722 : pré-condition fiscale qui bloque
 * le déploiement, pas un auto-repair).
 *
 * Prédicats STOP (= « casse/ambigu ») :
 *   1. 0 genesis alors qu'il existe des lignes  → chaîne sans racine.
 *   2. ≥2 genesis (deux lignes à prev = '0'×64) → racines multiples / fork.
 *   3. ≥2 successeurs d'un nœud (deux lignes au même prev = current d'un parent) → fork.
 *   4. `current` dupliqué entre deux lignes      → tête ambiguë (subsume le cas cycle).
 *   5. orphelins (lignes non atteintes depuis genesis) → chaîne brisée.
 *   6. credit_notes seulement : `cur`/`prev` NULL → ligne legacy non-chaînée
 *      (fiscal_journal est NOT NULL depuis 1717, n'a pas ce cas).
 *
 * Terminaison prouvée : pré-passage #4 (current dupliqué) + visited-set pendant
 * la marche → une chaîne corrompue STOP proprement au lieu de boucler à l'infini.
 *
 * `seq` n'est PAS haché : métadonnée d'ordre, zéro impact sur la chaîne existante.
 * Additif et non destructif (colonne nullable + index unique partiel). Réversible.
 */
export class AddCorrectiveChainSeqCursors1720000000001
  implements MigrationInterface
{
  name = 'AddCorrectiveChainSeqCursors1720000000001';

  /**
   * Per-store: read the chain rows, run the pure structural walk
   * (`walkChainSequence` — throws → rollback the migration tx on any break),
   * then assign `seqCol` in chain order. The walk IS the integrity audit.
   */
  private async walkAndAssign(
    qr: QueryRunner,
    table: string,
    seqCol: string,
  ): Promise<void> {
    const stores: Array<{ store_id: string }> = await qr.query(
      `SELECT DISTINCT store_id FROM ${table}`,
    );

    for (const { store_id } of stores) {
      const rows: ChainRow[] = await qr.query(
        `SELECT id, hash_chain_prev AS prev, hash_chain_current AS cur
           FROM ${table} WHERE store_id = $1`,
        [store_id],
      );
      const ordered = walkChainSequence(
        `[${this.name}] ${table} store ${store_id}`,
        rows,
      );
      for (const { id, seq } of ordered) {
        await qr.query(
          `UPDATE ${table} SET ${seqCol} = $1 WHERE id = $2`,
          [seq, id],
        );
      }
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- credit_notes.credit_note_seq ---
    await queryRunner.query(
      `ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS credit_note_seq bigint`,
    );
    await this.walkAndAssign(queryRunner, 'credit_notes', 'credit_note_seq');

    // --- fiscal_journal.journal_seq ---
    await queryRunner.query(
      `ALTER TABLE fiscal_journal ADD COLUMN IF NOT EXISTS journal_seq bigint`,
    );
    await this.walkAndAssign(queryRunner, 'fiscal_journal', 'journal_seq');

    // --- Gardes « SELECT-null » : aucune ligne ne doit rester sans seq après le
    //     walk (le walk assigne toutes les lignes atteintes ; orphelins → déjà
    //     STOP plus haut ; ce garde est une ceinture-et-bretelles). ---
    for (const [table, col] of [
      ['credit_notes', 'credit_note_seq'],
      ['fiscal_journal', 'journal_seq'],
    ] as const) {
      const missing: Array<{ n: string }> = await queryRunner.query(
        `SELECT count(*) AS n FROM ${table} WHERE ${col} IS NULL`,
      );
      if (Number(missing[0]?.n ?? 0) > 0) {
        throw new Error(
          `[${this.name}] gate: ${missing[0].n} ${table} row(s) without ${col} ` +
            `after walk — backfill incomplete, refusing to deploy.`,
        );
      }
    }

    // --- Index unique partiel : un seq unique par magasin (backstop structurel,
    //     comme uq_sales_store_sale_seq). Échoue bruyamment si une collision
    //     latente existe, au lieu de corrompre silencieusement. ---
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_notes_store_seq
         ON credit_notes(store_id, credit_note_seq)
         WHERE credit_note_seq IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_journal_store_seq
         ON fiscal_journal(store_id, journal_seq)
         WHERE journal_seq IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_fiscal_journal_store_seq`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_credit_notes_store_seq`);
    await queryRunner.query(
      `ALTER TABLE fiscal_journal DROP COLUMN IF EXISTS journal_seq`,
    );
    await queryRunner.query(
      `ALTER TABLE credit_notes DROP COLUMN IF EXISTS credit_note_seq`,
    );
  }
}
