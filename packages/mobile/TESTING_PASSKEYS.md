# TESTING_PASSKEYS.md — Checklist de test physique des clés d'accès (P371)

> **Ces tests sont MANUELS et restent à faire sur appareils réels.**
> L'E2E automatisé (authenticator virtuel CTAP2 Chrome) a prouvé le protocole
> (création, connexion découvrable, annulation, révocation) — pas l'ergonomie
> réelle de Face ID / Touch ID / Windows Hello / Android. Personne ne coche
> une case ici sans avoir tenu l'appareil en main.

## Pré-requis (une fois)

- Backend local démarré (`caisse-backend-verify`, port 3001) ou environnement de test équivalent.
- App mobile servie sur **http://localhost:5176** (`npm run dev -w packages/mobile`).
- Pour tester depuis un **téléphone réel**, `localhost` ne suffit pas :
  servir en HTTPS avec `npm run dev:https -w packages/mobile`, exposer la
  machine sur le réseau local, puis définir côté backend
  `WEBAUTHN_RP_ID=<hôte>` et `WEBAUTHN_ORIGINS=https://<hôte>:5176`
  (WebAuthn exige HTTPS hors `localhost` — c'est voulu).
- Comptes de test (base locale seedée) : admin `omar@wesley.test` / `9999`,
  manager `marie@wesley.test` / `1234`, caissier `paul@wesley.test` / `5555`.

## Scénario commun (à dérouler sur CHAQUE appareil)

1. Ouvrir `/login` → vérifier le libellé du bouton prioritaire :
   - iPhone/iPad : « Se connecter avec **Face ID** » ;
   - Mac : « Se connecter avec **Touch ID** » ;
   - Windows/Android : « Se connecter avec **une clé d'accès** ».
2. « Se connecter avec The Wesley » → email + code → entrer.
3. La feuille « Activer … ou une clé d'accès » apparaît → vérifier le nom
   proposé (« iPhone d'Omar », « Mac d'Omar », « PC du bureau »…) → **Activer**
   → l'invite biométrique NATIVE de l'OS s'affiche → valider.
   - ✅ attendu : « Clé d'accès activée », la clé apparaît dans `/security`.
4. Se déconnecter (ou navigation privée) → `/login` → bouton prioritaire →
   l'invite biométrique s'affiche **sans saisie d'email** → valider.
   - ✅ attendu : entrée directe, rôle correct (admin = réseau, manager = son magasin).
5. Recommencer et **annuler** l'invite biométrique.
   - ✅ attendu : « Connexion annulée. », le formulaire central reste utilisable.
6. `/security` → renommer la clé → révoquer la clé → retenter la connexion passkey.
   - ✅ attendu : « Clé d'accès inconnue ou révoquée », secours central OK.

## Matrice appareils

| # | Appareil / OS | Navigateur | Mécanisme | Résultat | Testé par / date |
|---|---|---|---|---|---|
| 1 | iPhone (iOS 17+) | Safari | Face ID | ☐ | |
| 2 | iPad | Safari | Face ID / Touch ID | ☐ | |
| 3 | Mac (Apple Silicon) | Safari | Touch ID | ☐ | |
| 4 | Mac | Chrome | Touch ID / profil iCloud | ☐ | |
| 5 | PC Windows 11 | Edge ou Chrome | Windows Hello (visage/empreinte/PIN appareil) | ☐ | |
| 6 | Android 14+ | Chrome | Biométrie / verrouillage sécurisé | ☐ | |
| 7 | Clé de sécurité FIDO2 (si disponible) | au choix | USB/NFC | ☐ | |

## Cas d'échec à observer spécifiquement

- **Annulation** de l'invite native → message propre, pas d'écran figé.
- **Appareil sans authenticator** (vieux PC) → le bouton passkey peut
  s'afficher (clé FIDO2 externe possible) : l'échec doit retomber sur le
  message générique et la connexion centrale.
- **Passkey iCloud synchronisée** (multiDevice) : créer sur iPhone, se
  connecter sur Mac → badge « synchronisée » attendu dans `/security`.
- **Deux clés sur le même compte** : les deux listées, révocation de l'une
  n'affecte pas l'autre.
- **Changement de rôle** entre création et connexion : modifier le rôle en
  base → la session suivante doit refléter le NOUVEAU rôle (droits serveur).
- **Compte désactivé** (`is_active=false`) → connexion passkey refusée.
- **Horloge décalée / lenteur réseau** : le challenge expire à 120 s → message
  « Challenge expiré » puis nouvelle tentative OK.

## Ce qu'on ne doit JAMAIS observer

- Une demande d'accès caméra par l'application.
- Un code magasin demandé où que ce soit.
- Une entrée `webauthn`/credential dans le localStorage.
- Une connexion qui aboutit après révocation ou désactivation du compte.
