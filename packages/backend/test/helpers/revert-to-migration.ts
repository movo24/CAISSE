import { DataSource } from 'typeorm';

/**
 * Déroule les down() jusqu'à ce que la migration CIBLE (incluse) ne soit plus
 * enregistrée dans la table `migrations`.
 *
 * Règle (registre des migrations — anti-récidive « revert par comptage ») :
 * un spec de migration ne compte JAMAIS ses undoLastMigration — l'hypothèse
 * « mes migrations sont les N dernières » casse dès que des lignées se
 * combinent (sync de branche, merge dans main). Il cible PAR NOM : tout ce
 * qui est empilé au-dessus de la cible est déroulé aussi, quel que soit
 * l'état de la lignée, et le re-run ré-applique l'ensemble.
 *
 * Garde anti-boucle-infinie : jamais plus d'itérations que de migrations
 * appliquées au départ ; cible absente dès le départ = erreur explicite
 * (le spec croit tester une migration qui n'a pas été appliquée).
 */
export async function revertToMigration(ds: DataSource, targetName: string): Promise<void> {
  const appliedNames = async (): Promise<string[]> =>
    (await ds.query('SELECT name FROM migrations')).map((r: { name: string }) => r.name);

  const initial = await appliedNames();
  if (!initial.includes(targetName)) {
    throw new Error(
      `revertToMigration: cible "${targetName}" absente de la table migrations — rien à dérouler (lignée inattendue ?)`,
    );
  }

  const maxSteps = initial.length;
  for (let i = 0; i < maxSteps; i++) {
    await ds.undoLastMigration({ transaction: 'each' });
    if (!(await appliedNames()).includes(targetName)) return;
  }
  throw new Error(
    `revertToMigration: cible "${targetName}" toujours enregistrée après ${maxSteps} undoLastMigration — garde anti-boucle déclenchée`,
  );
}
