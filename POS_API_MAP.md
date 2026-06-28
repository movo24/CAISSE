# POS_API_MAP.md — Cartographie API (vérifié 2026-06-28)

> 37 controllers, 213 routes. Légende statut : ✅ branché · 🟡 présent non prouvé live · ⛔ inexistant/à créer.
> ⚠️ Les méthodes/payloads détaillés par route doivent être complétés controller par controller (dette `TD-API-MAP`). Ci-dessous : inventaire des bases de routes confirmé + zones critiques détaillées.

## Bases de routes confirmées (`@Controller`)

| Base | Module | Statut | Note |
|---|---|---|---|
| `auth` | auth | 🟡 | PIN/QR/email + JWT ; PIN 500 prod à re-tester |
| `mobile`, `mobile/coupons` | mobile-auth, coupon | 🟡 | JWT audience `mobile-app` |
| `sales` | sales | 🟡 | `POST /`, `GET /`, `GET /:id`, `POST /:id/void` (vérifié) |
| `sales-ai` | sales-ai | 🟡 | suggestions prix, forecast |
| `sales-guards` | sales-guards | 🟡 | évaluation gardes pré-vente |
| `pos-sessions` | pos-session | 🟡 | session liée terminal |
| `returns` | returns | 🟡 | avoirs / NF525 chain |
| `receipts` | receipts | 🟡 | ⚠️ accès public + XSS signalés en avril → re-vérifier |
| `products` | products | 🟡 | CRUD, EAN, price-history |
| `promotions` | promotions | 🟡 | promo rules |
| `stock`, `stock-locations` | stock | 🟡 | mouvements, seuils |
| `inventory-scans` | inventory-scan | 🟡 | comptage |
| `stores`, `organizations`, `units` | org | 🟡 | hiérarchie ; sync TW24 |
| `employees` | employees | 🟡 | CRUD, QR badge |
| `customers`, `pos/loyalty`, `admin/loyalty` | loyalty | 🟡 | fidélité |
| `jackpot`, `occupancy`, `currency`, `subscriptions` | divers | 🟡 | — |
| `terminals`, `stripe-terminal` | paiement HW | 🟡 | registre + Stripe |
| `timewin` | timewin | 🟡 | sync stores/employés |
| `sync` | sync | 🟡 | push/pull offline |
| `notifications` | notifications | 🟡 | rappels |
| `audit` | audit | 🟡 | journal append-only |
| `connected-apps`, `airtable-ops` | intégrations | 🟡 | OAuth/clés, Airtable |
| `realtime` | (gateway) | 🟡 | temps réel |
| `health` | health | 🟡 | DB ping, 503 si DB down |

## Routes critiques détaillées (vérifié partiellement)

### Ventes — `sales`
| Méthode | URL | Statut | Notes |
|---|---|---|---|
| POST | `/api/sales` | 🟡 | Création vente ; **idempotency key requise** (entité `idempotency-key`, refs confirmées dans `sales.service.ts`) |
| GET | `/api/sales` | 🟡 | Liste |
| GET | `/api/sales/:id` | 🟡 | Détail |
| POST | `/api/sales/:id/void` | 🟡 | Annulation ; garde "void interdit sur paiement espèces réalisé" (commit `9da752f`) |

### À créer (⛔)
| Méthode | URL | But |
|---|---|---|
| GET | `/api/mobile/v1/alerts` | Cockpit mobile lecture seule (caisse/stock/paiement/fermeture/anomalies) |
| POST/GET | `/api/exports/accounting/*` | Exports Comptamax24 (ventes, paiements, TVA, caisse, espèces, remboursements) |
| (à définir) | Paywin24 heures/paie | Échange heures travaillées ↔ Paywin24 |

## Pour chaque route (gabarit à remplir — dette TD-API-MAP)
Méthode · URL · payload · réponse · erreurs · auth · rôle requis · statut réel · tests existants/à créer.
