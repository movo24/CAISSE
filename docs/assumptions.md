# Assumptions & Pragmatic Decisions

This document tracks technical decisions made pragmatically during development.

## Stack
- **NestJS over FastAPI**: Chose TypeScript backend for type sharing across entire stack. Python would require separate type definitions and a bridge.
- **Electron over Tauri**: Electron is more mature for dual-window POS. Tauri v2 could be revisited in V2 for smaller binary size.
- **TypeORM**: Works with both PostgreSQL and SQLite, enabling shared entity definitions.

## Money
- **Integer minor units**: All money stored as integers (centimes). No floating-point math for money. Ever.
- **Currency precision**: Handled per-currency (JPY=0, EUR=2, BHD=3). Stored in shared config.
- **FX at reporting time**: Stores operate in their currency. Cross-store reports convert at the FX rate valid at report generation time.

## Security
- **Hash chain, not signatures (MVP)**: SHA-256 hash chain provides tamper evidence but not non-repudiation. Digital signatures (RSA/ECDSA) planned for V1.
- **PIN stored as bcrypt hash**: Not reversible. PIN attempts throttled.
- **QR code as identifier**: The QR code itself is not secret -- it's like a username. PIN is still required.

## Sync
- **MVP: online-required for initial setup**: Products, promos, etc. must be synced before first offline use.
- **Conflict resolution**: Last-write-wins for product updates. Sales are append-only (no conflicts).
- **Sync queue**: Simple table in SQLite, processed FIFO when online.

## Promos
- **Buy X get Y discount**: Evaluated per-product across the entire cart. If 3 items of same product and rule is "buy 2 get 3rd at -50%", the cheapest gets the discount.
- **First purchase -5%**: Applied once per customer, ever. Tracked via `is_first_purchase` flag.

## Peripherals
- **Abstracted drivers**: Printer, drawer, scanner are behind interfaces. MVP uses mock implementations that log to console.
- **Scanner as keyboard**: Most barcode scanners act as keyboard input. POS listens for rapid character input ending in Enter.

## Reporting
- **Z-report is immutable**: Once generated, a Z-report cannot be modified. Corrections require a new X-report.
- **Peak hours**: Calculated from sale timestamps, grouped by hour.

## IA
- **Rule-based MVP**: No ML training data exists yet. Rules use: stock level, rotation speed, margin target, day-of-week patterns.
- **Interface-first**: IA service is behind an interface so real models can be swapped in later.
