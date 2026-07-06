# Accès administrateur — POS Caisse

> Objectif : retrouver ou recréer un accès admin **sans jamais inventer,
> hardcoder ou committer d'identifiants**. Aucun mot de passe n'est stocké dans
> le dépôt.

## Modèle d'authentification (important)

Il n'y a **pas de mot de passe séparé** : un administrateur se connecte avec
**email + PIN**. Le PIN est stocké haché (bcrypt) dans la table `employees`
(`pin_hash`). Le « mot de passe temporaire » généré par la CLI **devient ce PIN**.

Rôles : `admin (2) > manager (1) > cashier (0)`.

## Le build Windows ne nécessite AUCUN identifiant admin

- `vite build` / `tsc` / `electron-builder` produisent `Setup.exe` + portable
  **sans login backoffice, sans compte admin, sans secret de prod**.
- Seule variable *optionnelle* bakée au build : `VITE_API_URL` (sinon l'app
  pointe vers l'API de prod par défaut). Ce n'est pas un identifiant.
- Conclusion : **on peut générer et installer le `.exe` sans connaître aucun
  code admin.**

## Faut-il un admin pour tester la caisse ?

- **Écran client, panier de démo, mire 9:16, diagnostic terminal** : testables
  **sans compte admin prod** — l'écran client est piloté localement (dashboard
  POS > Écran client, boutons *Test panier* / *Mire* / *Identifier*).
- **Encaissement réel de bout en bout** (vente, ticket, paiement) : nécessite
  une **connexion employé** (PIN cashier/admin) contre une API. Utilisez un
  **compte de démo local/staging**, jamais la prod, pour les tests matériel.

## Modes disponibles

| Mode | Comment | Compte |
|------|---------|--------|
| Développement local | `npm run seed` (crée magasin + comptes démo) | `admin@caisse.dev` / PIN `SEED_ADMIN_PIN` (défaut dev `1234`) ; `cashier@caisse.dev` / `SEED_CASHIER_PIN` (défaut `5678`) |
| Test / staging | `npm run admin:create` sur la base staging | email + mot de passe temporaire généré |
| Production réelle | `npm run admin:reset` (opt-in prod explicite) | admin existant réinitialisé |
| Pairing terminal → magasin | à la connexion POS : saisir le **code magasin** + PIN | le `storeId` vient de l'employé ; le n° de terminal de l'écran client se règle dans *Écran client* |

> Les comptes `*.dev` sont des **fixtures de démonstration** (dev uniquement),
> jamais à utiliser en production.

## Créer un admin (local / dev)

```bash
cd packages/backend
export DATABASE_URL="postgresql://…"          # base locale/dev
export ADMIN_CLI_CONFIRM=I_UNDERSTAND         # garde-fou obligatoire
export ADMIN_EMAIL="admin@ton-magasin.fr"
export ADMIN_STORE_CODE="PARIS01"             # ou ADMIN_STORE_ID=<uuid>
npm run admin:create
```

Sortie : un **mot de passe temporaire** affiché **une seule fois** (généré si
`ADMIN_PASSWORD` n'est pas fourni). Il n'est jamais loggé ni committé.

## Réinitialiser un admin (staging / prod)

```bash
cd packages/backend
export DATABASE_URL="postgresql://…"          # base cible
export ADMIN_CLI_CONFIRM=I_UNDERSTAND
export ADMIN_EMAIL="admin@ton-magasin.fr"
# En PRODUCTION uniquement, opt-in explicite (sinon refus) :
export NODE_ENV=production
export ADMIN_CLI_ALLOW_PROD=YES
npm run admin:reset
```

`admin:reset` met à jour le PIN d'un compte **existant** (par email) et affiche
le nouveau mot de passe temporaire une fois.

## Variables d'environnement

| Var | Requis | Rôle |
|-----|--------|------|
| `DATABASE_URL` | oui | connexion Postgres |
| `ADMIN_CLI_CONFIRM` | oui | doit valoir `I_UNDERSTAND` |
| `ADMIN_EMAIL` | oui | email de l'admin |
| `ADMIN_PASSWORD` | non | impose un mot de passe temporaire (min 6) ; sinon généré |
| `ADMIN_STORE_CODE` / `ADMIN_STORE_ID` | create | magasin à rattacher |
| `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` | non | défauts `Admin` / `Caisse` |
| `NODE_ENV=production` + `ADMIN_CLI_ALLOW_PROD=YES` | prod | double opt-in prod |

## Garde-fous (appliqués et testés)

- Refus si `ADMIN_CLI_CONFIRM` ≠ `I_UNDERSTAND`.
- **Aucune création admin silencieuse en production** : `NODE_ENV=production`
  exige `ADMIN_CLI_ALLOW_PROD=YES`, sinon refus.
- Email obligatoire + validé.
- Mot de passe imposé (≥ 6) **ou** généré crypto-fort (jamais loggé).
- Log clair de l'opération (id, email, rôle, magasin, horodatage) — **sans** le mot de passe.
- `create` refuse un email déjà existant ; `reset` refuse un email inexistant.

## Premier login

1. Se connecter (backoffice ou POS) avec **email + mot de passe temporaire**.
2. **Changer le PIN immédiatement** via la gestion des employés / du profil.
3. Ne jamais réutiliser ni partager le mot de passe temporaire en clair.

> Note : une obligation *technique* de changement au premier login demanderait
> une colonne `must_change_pin` (migration additive sur `employees`) — non
> incluse ici pour ne pas modifier le schéma sans validation. Le changement au
> premier accès reste une **consigne opératoire**.

## Secrets — à ne JAMAIS committer

- Aucun PIN / mot de passe / `DATABASE_URL` réel dans le dépôt.
- `.env` réels dans `.gitignore` ; seul `.env.example` (placeholders) est versionné.
- Les comptes réels se créent via la CLI avec des variables d'environnement
  fournies au moment de l'exécution — jamais en dur dans le code.
