# CLAUDE.md - Development Guide

## Commands

```bash
# Install all dependencies
npm install

# Start development
npm run dev:backend      # NestJS API on :3001
npm run dev:pos          # Electron POS app
npm run dev:backoffice   # React back-office on :5173

# Infrastructure
npm run docker:up        # Start PostgreSQL
npm run docker:down      # Stop PostgreSQL

# Testing
npm run test             # All tests
npm run test:backend     # Backend tests only

# Code quality
npm run lint             # ESLint
npm run format           # Prettier
```

## Architecture Notes

- **Monorepo**: npm workspaces, 3 packages + shared
- **All money is integers**: Use `MoneyAmount` type, never floats
- **Audit entries are append-only**: Never update or delete
- **Hash chain**: Each audit entry references the previous hash
- **Shared types**: Import from `@caisse/shared`
- **Offline-first**: SyncModule handles push/pull between POS and server
- **QR loyalty**: NotificationsModule generates reminders for inactive customers

## Backend Modules (14)

| Module | Purpose |
|--------|---------|
| Auth | PIN + QR login, JWT generation |
| Products | CRUD, EAN scan, price history |
| Sales | Full POS flow, hash chain, mock peripherals |
| Employees | CRUD, QR badge generation |
| Customers | QR loyalty, OTP verification |
| Stores | Multi-store management |
| Reports | Z-report generation, daily summaries |
| Promotions | buy_x_get_discount, percentage, first_purchase |
| Stock | Decrement, adjust, threshold alerts |
| Audit | SHA-256 hash chain, append-only log |
| IA | Rule-based pricing suggestions, revenue forecast |
| Currency | FX rates, multi-currency conversion |
| Sync | Offline push/pull, conflict resolution |
| Notifications | QR loyalty reminders, stock alerts |

## Key Files

- `shared/types/` - All TypeScript interfaces (12 modules)
- `shared/utils/money.ts` - Currency formatting/conversion
- `shared/utils/hash.ts` - Audit hash chain utilities
- `packages/backend/src/modules/` - NestJS feature modules (14)
- `packages/backend/src/database/entities/` - TypeORM entities (13)
- `packages/pos-desktop/src/renderer/` - React POS UI
- `packages/pos-desktop/src/main/` - Electron main process (dual window)
- `packages/backoffice-web/src/` - React back-office UI
- `packages/backoffice-web/src/services/api.ts` - Full API client
- `packages/backoffice-web/src/stores/authStore.ts` - Zustand auth state

## Conventions

- Use UUID v4 for all entity IDs
- Use ISO 8601 for all dates
- Use snake_case for DB columns, camelCase for TypeScript
- Prefix shared imports with `@caisse/shared`
- Each module has: controller, service, module files
- Entity property `stockCriticalThreshold` (not stockAlertCritical)
- API base URL: `http://localhost:3001/api`
- POS desktop dev port: 5174, Back-office dev port: 5173
