# SOCIAL_CHART_TEMPLATE.md — Plan de comptes social À FAIRE VALIDER (GATE 3)

> P320 (cycle I3) — 2026-07-02. **Aucun code de compte n'est pré-rempli ici : c'est volontaire.** Le garde `canPostSocialEntries` (testé, fail-closed) refuse toute écriture sociale tant que ce plan n'est pas rempli ET validé par ton comptable. Ce document est le formulaire à lui transmettre.

## 1. Ce que ton comptable doit remplir

Le fichier à produire est un JSON (transmis via la configuration, jamais commité avec de vrais codes sans validation) :

```json
{
  "accounts": {
    "grossSalaries": "",
    "employerCharges": "",
    "socialAgenciesPayable": "",
    "netPayable": ""
  },
  "validatedBy": "",
  "validatedAt": ""
}
```

| Champ (slot sémantique) | Question à poser au comptable | Référence PCG indicative (à CONFIRMER par lui) |
|---|---|---|
| `grossSalaries` | Quel compte pour les rémunérations brutes du personnel ? | classe ~641 |
| `employerCharges` | Quel compte pour les charges sociales patronales ? | classe ~645 |
| `socialAgenciesPayable` | Quel compte de tiers pour les organismes sociaux (URSSAF, etc.) ? | classe ~431 |
| `netPayable` | Quel compte de tiers pour les rémunérations nettes dues au personnel ? | classe ~421 |
| `validatedBy` | Nom + qualité du valideur (ex. « Cabinet X, expert-comptable ») | preuve de validation |
| `validatedAt` | Date de validation ISO (`2026-07-15`) | — |

Les références PCG ci-dessus viennent du commentaire du garde et sont **indicatives** — subdivisions, auxiliaires et éventuels comptes analytiques sont la décision du comptable, pas la nôtre.

## 2. Points à faire trancher explicitement par le comptable

1. Codes exacts des 4 slots (avec subdivisions éventuelles : 6411/6451/4311/4211…).
2. Faut-il des comptes distincts par magasin/établissement (analytique) ou un plan unique réseau ?
3. Périodicité de déversement (mensuel à la paie ? au Z-report ?) — impacte le producteur, pas le garde.
4. Traitement des acomptes et des saisies-arrêts (hors périmètre actuel — à confirmer comme tel).

## 3. Activation le jour J (dans cet ordre, rien avant)

1. Remplir le JSON ci-dessus avec les codes validés → le fournir à la configuration du backend (variable/fichier de conf de l'environnement cible — jamais en dur dans le code).
2. `SOCIAL_ENTRIES_ENABLED=true` sur l'environnement.
3. Vérifier : `npx jest src/modules/comptamax/social-entries-guard.spec.ts` (le garde accepte un plan complet + validatedBy, refuse tout le reste — déjà testé).
4. Rollback : `SOCIAL_ENTRIES_ENABLED=false` (fail-closed immédiat, aucune donnée perdue).

## 4. Validation de structure (outil fourni)

`npm run social:check -- <fichier.json>` (P320) vérifie la STRUCTURE avant transmission : les 4 slots non vides, `validatedBy`/`validatedAt` présents, format de date. Il ne valide évidemment PAS la justesse comptable des codes — ça, c'est la signature du comptable.
