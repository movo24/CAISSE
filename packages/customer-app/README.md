# The Wesley Club — iOS Customer App

iOS loyalty companion app for The Wesley shops, connected to POS Caisse.

## Stack
- **Capacitor 6** + **React 18** + **Vite** + **TypeScript**
- **Bundle ID** : `com.thewesley.club`
- **Backend API** : `https://api.addxintelligence.com/api/mobile/*`

## Architecture (4 layers)
1. **iOS shell** — Capacitor bridges to Push, Preferences, Camera (later)
2. **React UI** — 4 main screens (Home / Card / Rewards / Profile)
3. **API service** — Axios with JWT refresh + Capacitor Preferences storage
4. **State** — local state per page; no global store needed for V1

## Screens

| Screen | Path | Purpose |
|--------|------|---------|
| Home | `/` | Welcome + active coupon hero + quick actions |
| LoyaltyCard | `/card` | QR full-screen with 60s rotation |
| Rewards | `/rewards` | Active coupon + history + how-it-works |
| Profile | `/profile` | Account info + RGPD delete |

## Security
- QR token: HMAC-SHA256, 60s TTL, server-rotated
- No personal data in QR
- Token stored in Capacitor Preferences (encrypted at rest on iOS)
- App refreshes QR every 60s (countdown visible)
- Auto-logout on refresh token failure

## Apple Store readiness
- ✅ Suppression compte intégrée (`/profile` → Trash button) — guideline 5.1.1(v)
- ✅ Privacy policy + Terms links visible
- ✅ Push opt-in non automatique (TODO Phase 3)
- ✅ Aucun mot interdit ("paiement", "wallet", "cashback", "crypto")
- ✅ Catégorie : Lifestyle
- ✅ Age rating : 4+

## Dev

```bash
cd packages/customer-app
npm install
npm run dev          # → http://localhost:5177
```

## Build + iOS
```bash
npm run build
npx cap add ios       # first time only
npm run ios:sync
npm run ios:open      # opens Xcode
```

## Decisions taken
- Auth: email + password (magic link to follow in Phase 2)
- Push: APNs direct via P8 token (Phase 3, not yet wired)
- Storage: Capacitor Preferences (no Realm/SQLite needed V1)
- Routing: Hash router (no server needed inside Capacitor)
