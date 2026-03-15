# CAISSE - Modern POS System

A modern, multi-store, multi-currency Point of Sale system designed for SaaS deployment in France/EU.

## Architecture

**Monorepo** (npm workspaces) with 3 packages:

| Package | Tech | Purpose |
|---------|------|---------|
| `packages/backend` | NestJS + TypeScript + PostgreSQL | Central API, reporting, sync |
| `packages/pos-desktop` | Electron + React + TypeScript + SQLite | Desktop POS (offline-first) |
| `packages/backoffice-web` | React + TypeScript | Management dashboard |
| `shared/` | TypeScript | Shared types, utils, constants |

### Why NestJS (not FastAPI)?
- **Full-stack TypeScript**: shared types between frontend and backend, one language, one toolchain
- **NestJS ecosystem**: built-in support for guards, interceptors, pipes, validation, Swagger
- **TypeORM**: works with both PostgreSQL (server) and SQLite (POS local)

### Why Electron (not Tauri)?
- **Mature ecosystem**: better support for dual-window (operator + client display)
- **Node.js access**: direct SQLite access, serial port for peripherals
- **Proven for POS**: used by Square, Shopify POS, etc.

## Quick Start

### Prerequisites
- Node.js >= 20
- Docker + Docker Compose (for PostgreSQL)
- npm >= 10

### Installation
```bash
# Clone and install
cd CAISSE
npm install

# Start PostgreSQL
npm run docker:up

# Start backend
npm run dev:backend

# Start POS desktop (new terminal)
npm run dev:pos

# Start back-office (new terminal)
npm run dev:backoffice
```

### Environment Variables

Create `.env` files in each package:

**packages/backend/.env**
```
DATABASE_URL=postgresql://caisse:caisse@localhost:5432/caisse
JWT_SECRET=your-secret-key-change-in-production
JWT_REFRESH_SECRET=your-refresh-secret-change-in-production
PORT=3001
```

**packages/pos-desktop/.env**
```
VITE_API_URL=http://localhost:3001
```

**packages/backoffice-web/.env**
```
VITE_API_URL=http://localhost:3001
```

## Project Structure
```
CAISSE/
├── packages/
│   ├── backend/          # NestJS API server
│   ├── pos-desktop/      # Electron POS app
│   └── backoffice-web/   # React management dashboard
├── shared/               # Shared types, utils, constants
├── docker/               # Docker Compose files
├── docs/                 # Documentation
├── scripts/              # Build & utility scripts
└── Makefile              # Common commands
```

## Key Design Decisions

1. **Money as integers**: All monetary values stored as minor units (centimes). No floats ever.
2. **Offline-first POS**: SQLite local DB, sync queue, works without network.
3. **Hash-chain audit**: Every ticket is SHA-256 chained to the previous one (NF525 path).
4. **Multi-currency**: Each store has a base currency; FX conversion at reporting time.
5. **IA behind interface**: Rule-based MVP, swappable for ML models later.

## License

Proprietary - All rights reserved.
