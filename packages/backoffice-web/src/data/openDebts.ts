/**
 * POS-FE-149 — Open technical debts / gates, surfaced to HQ for visibility.
 * Curated, maintained list (NOT live data): mirrors EXECUTION_LOG / TECHNICAL_DEBT.
 * Each item is something a manager/ops should know is NOT yet active or done.
 */
export type DebtSeverity = 'gate' | 'info';

export interface OpenDebt {
  id: string;
  label: string;
  impact: string;
  action: string;
  severity: DebtSeverity;
}

export const OPEN_DEBTS: OpenDebt[] = [
  {
    id: 'TD-INT-RELAY',
    label: 'Publication outbox HTTP réelle',
    impact: 'Comptamax/TimeWin/Analytik R ne reçoivent rien tant que non activé (simulation seule).',
    action: 'Fournir OUTBOX_PUBLISH_URL + OUTBOX_PUBLISH_SECRET puis OUTBOX_RELAY_ENABLED=true.',
    severity: 'gate',
  },
  {
    id: 'TD-INT-SOCIAL-ENTRIES',
    label: 'Écritures sociales réelles (paie)',
    impact: "L'export social est un justificatif RH, pas des écritures comptables.",
    action: 'Décision compta + plan de comptes social validés.',
    severity: 'gate',
  },
  {
    id: 'MIGRATION-1725',
    label: 'Migration table integration_events',
    impact: 'Les events outbox ne persistent pas tant que la migration 1725 n’est pas jouée.',
    action: 'migration:run en base cible (hors prod sans GO).',
    severity: 'gate',
  },
  {
    id: 'TD-FE-ROLLUP-NATIVE',
    label: 'Build + tests front (CI)',
    impact: 'Build/vitest front s’exécutent en CI Linux (configuré). Non lançables en bac à sable arm64 (binaire natif).',
    action: 'Vérifier le 1er run CI vert au prochain push.',
    severity: 'info',
  },
];
