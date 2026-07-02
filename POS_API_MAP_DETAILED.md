# POS_API_MAP_DETAILED.md — Cartographie API générée depuis le code

> Générée par `npm run api:map` — NE PAS éditer à la main, régénérer (la CI échoue si ce fichier ne correspond plus aux controllers).
> **43 controllers · 237 routes.** Auth : `JwtAuthGuard` (JWT employé) · `MobileAuthGuard` (JWT Wesley Club, audience mobile-app) · `RolesGuard` (hiérarchie admin>manager>cashier) · TenantInterceptor global (storeId du JWT) sauf `@SkipTenantCheck`.
> Colonne Rôles vide = tout JWT valide du guard indiqué ; Guards vide = route publique (vérifier le contexte du controller).

## `modules/airtable-ops/airtable-ops.controller.ts` — base `/airtable-ops`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/airtable-ops/operations` | listOperations | JwtAuthGuard | — | ✓ | — |
| GET | `/airtable-ops/operations/:id` | getOperation | JwtAuthGuard | — | ✓ | — |
| POST | `/airtable-ops/operations/:id/approve` | approveOperation | JwtAuthGuard | — | ✓ | — |
| POST | `/airtable-ops/operations/:id/reject` | rejectOperation | JwtAuthGuard | — | ✓ | — |
| POST | `/airtable-ops/operations/:id/apply` | applyOperation | JwtAuthGuard | — | ✓ | — |
| POST | `/airtable-ops/sync` | triggerSync | JwtAuthGuard | — | ✓ | — |
| GET | `/airtable-ops/stats` | getStats | JwtAuthGuard | — | ✓ | — |
| GET | `/airtable-ops/logs` | getLogs | JwtAuthGuard | — | ✓ | — |
| POST | `/airtable-ops/webhook` | handleWebhook | — | — | ✓ | — |

## `modules/audit/audit.controller.ts` — base `/audit`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/audit` | getEntries | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/audit/verify` | verifyChain | JwtAuthGuard, RolesGuard | admin | ✓ | — |

## `modules/auth/auth.controller.ts` — base `/auth`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/auth/login/pin` | loginPin | — | — | ⚠️ skip | — |
| POST | `/auth/login/admin` | loginAdmin | — | — | ✓ | — |
| POST | `/auth/login/qr` | loginQr | — | — | ✓ | — |
| POST | `/auth/refresh` | refresh | — | — | ✓ | — |
| POST | `/auth/logout` | logout | JwtAuthGuard | — | ✓ | — |

## `modules/backoffice-discounts/backoffice-discount.controller.ts` — base `/backoffice/discounts`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/backoffice/discounts/authorize` | authorize | JwtAuthGuard, RolesGuard | admin | ✓ | — |

## `modules/comptamax/comptamax.controller.ts` — base `/comptamax`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/comptamax/journal` | journal | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/comptamax/cash-control` | cashControl | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/comptamax/social` | social | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |

## `modules/connected-apps/connected-apps.controller.ts` — base `/connected-apps`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/connected-apps` | findAll | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/connected-apps/:id` | findOne | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/connected-apps` | create | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| PUT | `/connected-apps/:id` | update | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |
| PUT | `/connected-apps/:id/deactivate` | deactivate | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |

## `modules/coupon/coupon.controller.ts` — base `/mobile/coupons`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/mobile/coupons` | list | MobileAuthGuard | — | ✓ | — |
| GET | `/mobile/coupons/active` | active | MobileAuthGuard | — | ✓ | — |
| GET | `/mobile/coupons/history` | history | MobileAuthGuard | — | ✓ | — |

## `modules/currency/currency.controller.ts` — base `/currency`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/currency/rates` | setRate | JwtAuthGuard + RolesGuard | admin | ✓ | — |
| GET | `/currency/rates` | getAllRates | JwtAuthGuard | — | ✓ | — |
| GET | `/currency/rates/pair` | getRate | JwtAuthGuard | — | ✓ | — |
| GET | `/currency/convert` | convert | JwtAuthGuard | — | ✓ | — |

## `modules/customer-visits/customer-visits.controller.ts` — base `/customer-visits`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/customer-visits/:customerId/frequency` | getFrequency | JwtAuthGuard, RolesGuard | manager | ✓ | — |

## `modules/customers/customers.controller.ts` — base `/customers`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/customers` | create | JwtAuthGuard | — | ✓ | — |
| GET | `/customers` | findAll | JwtAuthGuard | — | ✓ | — |
| GET | `/customers/qr/:qrCode` | findByQr | JwtAuthGuard | — | ✓ | — |
| GET | `/customers/:id` | findOne | JwtAuthGuard | — | ✓ | — |
| POST | `/customers/:id/verify` | verify | JwtAuthGuard | — | ✓ | — |

## `modules/employees/employees.controller.ts` — base `/employees`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/employees/me/rights` | getMyRights | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/employees/rights/defaults` | getRoleDefaults | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/employees/:id/rights` | getEmployeeRights | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| POST | `/employees` | create | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| GET | `/employees` | findAll | JwtAuthGuard, RolesGuard | admin,admin,manager | ✓ | — |
| GET | `/employees/:id` | findOne | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/employees/:id/qr` | getQr | JwtAuthGuard, RolesGuard | — | ✓ | — |
| PUT | `/employees/:id` | update | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| PATCH | `/employees/:id/pin` | changePin | JwtAuthGuard, RolesGuard | admin,admin,manager | ✓ | — |
| POST | `/employees/:id/deactivate` | deactivate | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| POST | `/employees/:id/reactivate` | reactivate | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |
| DELETE | `/employees/:id` | deactivateViaDelete | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |

## `modules/health/health.controller.ts` — base `/health`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/health` | check | — | — | ✓ | — |
| GET | `/health/metrics` | metrics | JwtAuthGuard | — | ✓ | — |

## `modules/integration/integration.controller.ts` — base `/integration`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/integration/reconciliation` | reconciliationToday | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/integration/events` | events | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/integration/shifts` | shifts | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/integration/stock-signals` | stockSignals | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/integration/outbox/stats` | outboxStats | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| POST | `/integration/relay` | runRelay | JwtAuthGuard, RolesGuard | admin | ✓ | — |

## `modules/inventory-scan/inventory-scan.controller.ts` — base `/inventory-scans`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/inventory-scans` | recordScan | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/inventory-scans` | listScans | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/inventory-scans/apply` | applyScans | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/inventory-scans/session/:sessionId/stats` | getSessionStats | JwtAuthGuard, RolesGuard | — | ✓ | — |

## `modules/jackpot/jackpot.controller.ts` — base `/jackpot`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/jackpot/:storeId/config` | getConfig | JwtAuthGuard | — | ✓ | — |
| POST | `/jackpot/:storeId/config` | createConfig | JwtAuthGuard + RolesGuard | admin | ✓ | — |
| PUT | `/jackpot/:storeId/config` | updateConfig | JwtAuthGuard + RolesGuard | admin | ✓ | — |
| GET | `/jackpot/:storeId/status` | getStatus | JwtAuthGuard | — | ✓ | — |
| GET | `/jackpot/:storeId/history` | getHistory | JwtAuthGuard + RolesGuard | admin,manager | ✓ | — |

## `modules/loyalty-admin/loyalty-admin.controller.ts` — base `/admin/loyalty`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/admin/loyalty/cycles` | listCycles | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/admin/loyalty/cycles` | createCycle | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| PATCH | `/admin/loyalty/cycles/:id` | updateCycle | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| DELETE | `/admin/loyalty/cycles/:id` | deactivateCycle | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| POST | `/admin/loyalty/coupons` | issueManual | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| GET | `/admin/loyalty/analytics` | analytics | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/admin/loyalty/customers` | listCustomers | JwtAuthGuard, RolesGuard | — | ✓ | — |

## `modules/loyalty-card/loyalty-card.controller.ts` — base `/mobile`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/mobile/loyalty-card` | getCard | MobileAuthGuard | — | ✓ | — |
| POST | `/mobile/loyalty-card/regenerate-qr` | rotate | MobileAuthGuard | — | ✓ | — |

## `modules/mobile-auth/mobile-auth.controller.ts` — base `/mobile`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/mobile/auth/register` | register | — | — | ✓ | — |
| POST | `/mobile/auth/login` | login | — | — | ✓ | — |
| POST | `/mobile/auth/refresh` | refresh | — | — | ✓ | — |
| POST | `/mobile/auth/logout` | logout | — | — | ✓ | — |
| GET | `/mobile/me` | getMe | MobileAuthGuard | — | ✓ | — |
| PATCH | `/mobile/me` | updateMe | MobileAuthGuard | — | ✓ | — |
| DELETE | `/mobile/me` | deleteMe | MobileAuthGuard | — | ✓ | — |

## `modules/mobile-cockpit/mobile-cockpit.controller.ts` — base `/mobile/v1`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/mobile/v1/alerts` | getAlerts | JwtAuthGuard, RolesGuard | manager | ✓ | — |

## `modules/notifications/notifications.controller.ts` — base `/notifications`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/notifications/summary` | getSummary | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/notifications/loyalty-reminders` | getLoyaltyReminders | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/notifications/stock-alerts` | getStockAlerts | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/notifications/send-qr-reminder/:customerId` | sendQrReminder | JwtAuthGuard, RolesGuard | — | ✓ | — |

## `modules/occupancy/occupancy.controller.ts` — base `/occupancy`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/occupancy/update` | update | — | — | ⚠️ skip | — |
| GET | `/occupancy/:storeId` | getOccupancy | JwtAuthGuard | — | ✓ | — |

## `modules/organizations/organizations.controller.ts` — base `/organizations`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/organizations` | findAll | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/organizations/:id` | findOne | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/organizations` | create | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| PUT | `/organizations/:id` | update | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |
| PUT | `/organizations/:id/deactivate` | deactivate | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |

## `modules/pos-integration/pos-loyalty.controller.ts` — base `/pos/loyalty`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/pos/loyalty/scan` | scan | JwtAuthGuard | — | ✓ | — |
| POST | `/pos/loyalty/redeem` | redeem | JwtAuthGuard | — | ✓ | — |
| POST | `/pos/loyalty/visit` | visit | JwtAuthGuard | — | ✓ | — |

## `modules/pos-session/pos-session.controller.ts` — base `/pos-sessions`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/pos-sessions/open` | open | JwtAuthGuard | — | ✓ | — |
| POST | `/pos-sessions/:id/close` | close | JwtAuthGuard | — | ✓ | — |
| GET | `/pos-sessions/:id/cash-summary` | cashSummary | JwtAuthGuard | — | ✓ | — |
| GET | `/pos-sessions/active` | active | JwtAuthGuard | — | ✓ | — |

## `modules/products/products.controller.ts` — base `/products`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/products` | create | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| POST | `/products/import` | importCatalog | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/products` | findAll | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/products/scan/:ean` | findByEan | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/products/categories` | getCategories | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/products/categories` | createCategory | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/products/stock-alerts` | stockAlerts | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/products/:id` | findOne | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/products/:id/price-history` | priceHistory | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/products/:id/price-analytics` | priceAnalytics | JwtAuthGuard, RolesGuard | — | ✓ | — |
| PUT | `/products/:id` | update | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| POST | `/products/:id/generate-barcode` | generateBarcode | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| DELETE | `/products/:id` | remove | JwtAuthGuard, RolesGuard | admin,manager,admin | ✓ | — |

## `modules/promotions/promotions.controller.ts` — base `/promotions`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/promotions` | create | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/promotions` | findAll | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/promotions/active` | getActive | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/promotions/:id` | findOne | JwtAuthGuard, RolesGuard | — | ✓ | — |
| PUT | `/promotions/:id` | update | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |

## `modules/receipts/receipts.controller.ts` — base `/receipts`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/receipts/:saleId` | getReceipt | — | — | ⚠️ skip | — |
| GET | `/receipts/:saleId/html` | getReceiptHtml | — | — | ⚠️ skip | — |
| GET | `/receipts/:saleId/pdf` | getReceiptPdf | — | — | ⚠️ skip | — |
| POST | `/receipts/:saleId/email` | emailReceipt | JwtAuthGuard | — | ⚠️ skip | — |

## `modules/reports/reports.controller.ts` — base `/reports`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/reports/z-report` | generateZReport | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/reports/z-report` | getZReport | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/reports/daily-summary` | getDailySummary | JwtAuthGuard, RolesGuard | admin,manager,admin,manager | ✓ | — |
| GET | `/reports/store-kpi` | getStoreKpi | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/reports/product-analytics` | getProductAnalytics | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/reports/sales-trend` | getSalesTrend | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/reports/sales-by-employee` | getSalesByEmployee | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/reports/accounting-export` | getAccountingExport | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/reports/payments-breakdown` | getPaymentsBreakdown | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |

## `modules/returns/returns.controller.ts` — base `/returns`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/returns` | create | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| POST | `/returns/by-ticket` | createByTicket | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| POST | `/returns/gift-card` | issueGiftCard | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/returns` | list | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/returns/sale/:saleId/returnable` | returnable | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/returns/credit-note/:code` | lookup | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/returns/:id` | findOne | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |

## `modules/sales-ai/sales-ai.controller.ts` — base `/sales-ai`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/sales-ai/recommendations` | getRecommendations | JwtAuthGuard | — | ✓ | — |
| GET | `/sales-ai/associations` | getAssociations | JwtAuthGuard | — | ✓ | — |
| GET | `/sales-ai/hourly-patterns` | getHourlyPatterns | JwtAuthGuard | — | ✓ | — |
| GET | `/sales-ai/stats` | getStats | JwtAuthGuard | — | ✓ | — |
| GET | `/sales-ai/time-context` | getTimeContext | JwtAuthGuard | — | ✓ | — |
| GET | `/sales-ai/external-context` | getExternalContext | JwtAuthGuard | — | ✓ | — |
| POST | `/sales-ai/log/display` | logDisplay | JwtAuthGuard | — | ✓ | — |
| PATCH | `/sales-ai/log/:logId/click` | logClick | JwtAuthGuard | — | ✓ | — |
| PATCH | `/sales-ai/log/:logId/add-to-cart` | logAddToCart | JwtAuthGuard | — | ✓ | — |
| PATCH | `/sales-ai/log/:logId/convert` | logConversion | JwtAuthGuard | — | ✓ | — |
| GET | `/sales-ai/kpi` | getKPI | JwtAuthGuard | — | ✓ | — |

## `modules/sales-guards/sales-guards.controller.ts` — base `/sales-guards`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/sales-guards/config` | getConfig | JwtAuthGuard | — | ✓ | — |
| POST | `/sales-guards/evaluate` | evaluate | JwtAuthGuard | — | ✓ | — |
| GET | `/sales-guards/anomalies` | listAnomalies | JwtAuthGuard | — | ✓ | — |
| GET | `/sales-guards/anomalies/summary` | getSummary | JwtAuthGuard | — | ✓ | — |
| POST | `/sales-guards/anomalies/:id/approve` | approve | JwtAuthGuard | — | ✓ | — |
| POST | `/sales-guards/anomalies/:id/ignore` | ignore | JwtAuthGuard | — | ✓ | — |

## `modules/sales/sales.controller.ts` — base `/sales`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/sales` | create | JwtAuthGuard | — | ✓ | — |
| GET | `/sales` | findAll | JwtAuthGuard | — | ✓ | — |
| GET | `/sales/:id` | findOne | JwtAuthGuard | — | ✓ | — |
| POST | `/sales/:id/void` | voidSale | JwtAuthGuard + RolesGuard | admin,manager | ✓ | — |

## `modules/stock-locations/stock-locations.controller.ts` — base `/stock-locations`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/stock-locations/locations` | listLocations | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/stock-locations/locations` | createLocation | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| GET | `/stock-locations/network` | getNetworkStock | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/stock-locations/product/:productId/balances` | getProductBalances | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/stock-locations/location/:locationId/balances` | getLocationBalances | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/stock-locations/receive` | receiveFromSupplier | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| POST | `/stock-locations/transfer` | transfer | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| POST | `/stock-locations/dispatch` | dispatch | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| GET | `/stock-locations/movements/product/:productId` | getProductMovements | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/stock-locations/movements/location/:locationId` | getLocationMovements | JwtAuthGuard, RolesGuard | — | ✓ | — |

## `modules/stock/stock.controller.ts` — base `/stock`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/stock/alerts` | getAlerts | JwtAuthGuard | — | ✓ | — |
| GET | `/stock/reconcile` | reconcile | JwtAuthGuard + RolesGuard | admin,manager | ✓ | — |
| PUT | `/stock/default-thresholds` | updateDefaultThresholds | JwtAuthGuard + RolesGuard | admin,manager | ✓ | — |
| POST | `/stock/variance` | variance | JwtAuthGuard + RolesGuard | admin,manager | ✓ | — |
| POST | `/stock/:productId/adjust` | adjust | JwtAuthGuard + RolesGuard | admin,manager | ✓ | — |

## `modules/stores/stores.controller.ts` — base `/stores`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/stores` | findAll | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/stores` | create | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| GET | `/stores/accessible` | accessible | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/stores/network-summary` | networkSummary | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| GET | `/stores/me` | getMyStore | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/stores/me/info` | getMyStoreInfo | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/stores/:id` | findOne | JwtAuthGuard, RolesGuard | — | ✓ | — |
| PUT | `/stores/:id` | update | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| PATCH | `/stores/:id/archive` | archive | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| PATCH | `/stores/:id/reactivate` | reactivate | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |
| POST | `/stores/:id/activate` | activate | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |
| POST | `/stores/:id/deactivate` | deactivate | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |
| POST | `/stores/sync` | syncFromTimeWin | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |
| DELETE | `/stores/:id` | hardDelete | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |
| GET | `/stores/:id/schedule` | getSchedule | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| PUT | `/stores/:id/schedule` | updateSchedule | JwtAuthGuard, RolesGuard | admin,manager,admin | ✓ | — |

## `modules/stripe-terminal/stripe-terminal.controller.ts` — base `/stripe-terminal`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/stripe-terminal/connection-token` | getConnectionToken | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/stripe-terminal/payment-intent` | createPaymentIntent | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/stripe-terminal/payment-intent/:id` | getPaymentIntent | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/stripe-terminal/payment-intent/:id/cancel` | cancelPaymentIntent | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/stripe-terminal/locations` | listLocations | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/stripe-terminal/readers` | listReaders | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/stripe-terminal/readers/register` | registerReader | JwtAuthGuard, RolesGuard | admin | ✓ | — |

## `modules/subscriptions/subscriptions.controller.ts` — base `/subscriptions`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/subscriptions/plans` | getPlans | — | — | ⚠️ skip | — |
| GET | `/subscriptions/:storeId` | getSubscription | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/subscriptions/:storeId/usage` | getUsage | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/subscriptions/:storeId/change-plan` | changePlan | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/subscriptions/:storeId/cancel` | cancel | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/subscriptions/:storeId/trial` | createTrial | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/subscriptions/:storeId/checkout` | createCheckout | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| POST | `/subscriptions/:storeId/portal` | createPortal | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| POST | `/subscriptions/webhook` | handleWebhook | — | — | ⚠️ skip | — |

## `modules/suppliers/suppliers.controller.ts` — base `/suppliers`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/suppliers` | list | JwtAuthGuard | — | ✓ | — |
| POST | `/suppliers` | create | JwtAuthGuard + RolesGuard | admin,manager | ✓ | — |
| PUT | `/suppliers/:id` | update | JwtAuthGuard + RolesGuard | admin,manager | ✓ | — |
| DELETE | `/suppliers/:id` | deactivate | JwtAuthGuard + RolesGuard | admin,manager | ✓ | — |

## `modules/sync/sync.controller.ts` — base `/sync`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| POST | `/sync/push` | push | JwtAuthGuard | — | ✓ | — |
| GET | `/sync/pull` | pull | JwtAuthGuard | — | ✓ | — |
| GET | `/sync/status` | status | JwtAuthGuard | — | ✓ | — |

## `modules/terminals/terminals.controller.ts` — base `/terminals`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/terminals` | findAll | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/terminals` | create | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| PATCH | `/terminals/:id` | update | JwtAuthGuard, RolesGuard | admin,manager | ✓ | — |
| POST | `/terminals/:id/heartbeat` | heartbeat | JwtAuthGuard, RolesGuard | — | ✓ | — |

## `modules/timewin/timewin.controller.ts` — base `/timewin`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/timewin/health` | health | JwtAuthGuard | — | ✓ | — |
| POST | `/timewin/login` | login | — | — | ✓ | — |
| GET | `/timewin/employees/:id/context` | context | JwtAuthGuard | — | ✓ | — |
| GET | `/timewin/employees/sync` | syncEmployees | JwtAuthGuard | — | ✓ | — |
| GET | `/timewin/today-shifts` | todayShifts | JwtAuthGuard | — | ✓ | — |
| GET | `/timewin/payroll` | payroll | JwtAuthGuard | — | ✓ | — |
| GET | `/timewin/store-config` | storeConfig | JwtAuthGuard | — | ✓ | — |
| GET | `/timewin/store-schedule` | getStoreSchedule | JwtAuthGuard | — | ✓ | — |
| PUT | `/timewin/store-schedule` | updateStoreSchedule | JwtAuthGuard | — | ✓ | — |
| GET | `/timewin/stores` | stores | JwtAuthGuard | — | ✓ | — |
| POST | `/timewin/clock-in` | clockIn | JwtAuthGuard | — | ✓ | — |
| POST | `/timewin/clock-out` | clockOut | JwtAuthGuard | — | ✓ | — |
| POST | `/timewin/events` | pushEvent | JwtAuthGuard | — | ✓ | — |

## `modules/units/units.controller.ts` — base `/units`

| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |
|---|---|---|---|---|---|---|
| GET | `/units` | findAll | JwtAuthGuard, RolesGuard | — | ✓ | — |
| GET | `/units/:id` | findOne | JwtAuthGuard, RolesGuard | — | ✓ | — |
| POST | `/units` | create | JwtAuthGuard, RolesGuard | admin | ✓ | — |
| PUT | `/units/:id` | update | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |
| PUT | `/units/:id/deactivate` | deactivate | JwtAuthGuard, RolesGuard | admin,admin | ✓ | — |
