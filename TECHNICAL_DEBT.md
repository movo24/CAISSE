# TECHNICAL_DEBT.md — Dette technique (vérifié 2026-06-28)

> Honnêteté : un item reste ouvert tant qu'il n'est pas prouvé résolu (commit + test).

| ID | Dette | Sévérité | Preuve / Localisation | Statut |
|---|---|---|---|---|
| TD-DOC-DRIFT | CLAUDE.md sous-compte modules (37→40), entités (45→47), migrations (11→16), tests (405→~488) | 🟠 | comparaison audit vs CLAUDE.md | Ouvert |
| TD-API-MAP | Détail méthode/payload/erreurs/rôle manquant pour la plupart des 213 routes | 🟠 | `POS_API_MAP.md` | Ouvert |
| TD-MOBILE-COCKPIT | `GET /api/mobile/v1/alerts` inexistant | 🟠 | grep backend | Ouvert |
| TD-PAYWIN | Paywin24 non branché (aucune réf code) | 🟠 | grep `paywin` = 0 | Ouvert (futur) |
| TD-COMPTAMAX | Comptamax24 non branché (aucune réf code) | 🟠 | grep `comptamax` = 0 | Ouvert (futur) |
| TD-OFFLINE-TESTS | Tests offline auto non confirmés | 🟠 | `POS_OFFLINE_STRATEGY.md` | Ouvert |
| TD-PAYMENT-TESTS | Tests paiement simulé à étendre | 🟠 | `POS_PAYMENT_STRATEGY.md` | Ouvert |
| TD-FULL-SUITE-CI | Suite complète non confirmée verte (sandbox 45 s) | 🟠 | `PROJECT_STATUS.md` §3 | Ouvert |
| TD-BCRYPT-NATIVE | `bcrypt` natif lié à la plateforme (rebuild requis hors macOS) | 🟡 | `invalid ELF header` | Atténué (rebuild Linux) |
| TD-SEC-AVRIL | Points sécurité avril (PIN500, receipts public/XSS, secrets git) | 🔴/🟠 | `POS_SECURITY.md` | À vérifier |
| TD-FRONT-ERRORS | Erreurs avalées (StockAlertsPage, LabelsPage) | 🟠 | AUDIT-FINAL avril | À vérifier |
| TD-DEAD-BUTTONS | Boutons exports inactifs (Produits/Reports) | 🟡 | AUDIT-FINAL avril | À vérifier |
| TD-UNTRACKED | `InventoryVariancePage.tsx` non commité, `RAPPORT_20H.md` non suivi | 🟡 | `git status` | Ouvert |

## Règle

Chaque nouvelle dette détectée pendant un paquet est ajoutée ici avec ID, preuve, sévérité, statut.
