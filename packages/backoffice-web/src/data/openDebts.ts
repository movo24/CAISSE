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
    impact: 'Mécaniques POST+signature prouvées (test loopback P171) ; en prod, simulation seule tant que l’URL/secret réels ne sont pas fournis.',
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
    impact: 'SQL up()/down() prouvé (pg-mem P176) + parité entité (P177) ; events non persistés tant que la migration n’est pas jouée sur la base cible.',
    action: 'migration:run en base cible (hors prod sans GO).',
    severity: 'gate',
  },
];
