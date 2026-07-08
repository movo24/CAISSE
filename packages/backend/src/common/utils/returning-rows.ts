/**
 * Normalise le résultat d'un `UPDATE … RETURNING` exécuté via TypeORM `query()`.
 *
 * Sur le driver postgres réel, TypeORM retourne `[rows, rowCount]` (un tableau
 * de DEUX éléments — jamais vide) ; pg-mem et d'autres chemins retournent les
 * rows nues. Un check `res.length === 0` direct est donc FAUX sur vrai Postgres
 * — c'est le bug de classe révélé par le premier run des specs pg réels (bloc
 * TEST_DATABASE_URL) : cap promo jamais déclenché, sur-vente de stock possible.
 */
export function returningRows(res: unknown): unknown[] {
  if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') {
    return res[0]; // forme driver postgres : [rows, rowCount]
  }
  return Array.isArray(res) ? res : [];
}
