# The Wesley Control — application mobile de direction

Vraie application mobile **iOS + Android** (Expo / React Native, pas un site web
emballé) pour le pilotage du réseau The Wesley : CA temps quasi réel, tickets,
panier moyen, marge brute, paiements, remboursements/annulations, alertes stock
et anomalies de caisse, comparateur multi-magasins.

**Lecture seule par construction** : l'app ne consomme que des endpoints GET ;
aucun changement de prix, de vente ou de stock n'est possible depuis le mobile.

## Stack

- Expo SDK 52 / React Native 0.76 / TypeScript strict
- Navigation : @react-navigation (onglets + stacks)
- Tokens JWT dans le **Keychain iOS / Keystore Android** (expo-secure-store)
- Biométrie : expo-local-authentication (Face ID / Touch ID / empreinte)
- Aucun secret embarqué — seule l'URL publique du backend est configurée
- Tests logique pure : vitest (`npm test`), typecheck : `npm run typecheck`

## Backend consommé

| Endpoint | Usage |
|---|---|
| `POST /api/auth/login/admin` | connexion direction (email + PIN) |
| `POST /api/auth/login/pin` | connexion responsable (code magasin + PIN) |
| `POST /api/auth/refresh` | refresh silencieux (single-flight) |
| `GET /api/mobile/v1/direction/overview` | accueil réseau (nouveau) |
| `GET /api/mobile/v1/direction/stores` | liste magasins + KPI (nouveau) |
| `GET /api/mobile/v1/direction/stores/:id` | fiche magasin (nouveau) |
| `GET /api/mobile/v1/direction/compare` | comparateur (nouveau) |
| `GET /api/mobile/v1/alerts` | cockpit alertes POS-110 (réutilisé — si absent du backend, l'app affiche un message dédié) |

Rôles : `admin` = tout le réseau ; `manager` = son magasin + accès explicites
(`employee_store_access`). Les cashiers et les clients (JWT `mobile-app`) sont
refusés. Hors périmètre ⇒ 404 identique à un magasin inexistant.

## Configuration

L'URL backend vient de `EXPO_PUBLIC_API_URL` (profils EAS dans `eas.json`) :
`preview` → Backend B sandbox Railway ; `production` → `api.addxintelligence.com`.
Par défaut (dev) : sandbox.

## Lancer en dev

```bash
npm run dev:control        # à la racine du monorepo (expo start)
```

Scanner le QR avec Expo Go (ou build de dev EAS pour la biométrie complète).

## Builds installables

```bash
cd packages/wesley-control
npx eas build --profile preview --platform android   # APK interne
npx eas build --profile preview --platform ios       # TestFlight (compte Apple requis)
```

Prérequis owner (non commitables) : compte Expo/EAS, certificat de distribution
Apple + App Store Connect API key, keystore Android (généré par EAS). Icône et
splash actuels = placeholders générés (`scripts/make-assets.js`) à remplacer
par les assets de marque avant soumission.

## Décisions produit V1

- « Ne jamais afficher de faux zéro » : en cas d'échec réseau, l'app garde le
  dernier état connu et affiche « Données non actualisées » (machine à états
  testée dans `src/lib/freshness.ts`).
- Rafraîchissement : auto toutes les 60 s + pull-to-refresh (SSE réseau global
  viendra en V2 ; le backend expose déjà un SSE par magasin).
- Notifications push : V2 — nécessitent les certificats push du compte owner.
- Le concept « région » n'existe pas encore dans le modèle (org → unit → store) ;
  le périmètre régional utilisera `employee_store_access` en attendant.
