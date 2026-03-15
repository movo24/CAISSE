# Architecture

## System Overview

```
+-------------------------------------------------------------+
|                     CLOUD / SERVER                          |
|  +--------------+  +--------------+  +------------------+  |
|  |  NestJS API  |  |  PostgreSQL  |  |  IA Module       |  |
|  |  (REST)      |--|  (central DB)|  |  (pricing/       |  |
|  |  JWT + RBAC  |  |              |  |   forecasting)   |  |
|  +------+-------+  +--------------+  +------------------+  |
|         |                                                    |
+---------+----------------------------------------------------+
          | HTTPS / REST
          | (sync pull/push)
+---------+----------------------------------------------------+
|  STORE  |                                                    |
|  +------+-------+                                            |
|  | POS Desktop  |    +--------------+                        |
|  | (Electron)   |    | Client       |                        |
|  | +----------+ |    | Display      |                        |
|  | | SQLite   | |    | (2nd window) |                        |
|  | | (local)  | |    +--------------+                        |
|  | +----------+ |                                            |
|  | +----------+ |    +--------------+                        |
|  | | Sync     | |    | Peripherals  |                        |
|  | | Queue    | |    | - Printer    |                        |
|  | +----------+ |    | - Scanner    |                        |
|  +--------------+    | - Drawer     |                        |
|                      +--------------+                        |
|  +----------------------------------------------------------+|
|  |             Back-Office Web (React SPA)                  ||
|  |             Accessed via browser on any device            ||
|  +----------------------------------------------------------+|
+--------------------------------------------------------------+
```

## Data Flow

### Sale Flow
```
1. Employee scans QR badge -> session opened
2. Scan product EAN -> product added to cart
3. System checks promos -> discount applied
4. Scan customer QR -> loyalty applied
5. Select payment method -> CB / cash / mixed
6. Payment processed -> ticket generated
7. Hash chain: SHA-256(prev_hash + ticket_data) -> audit log
8. Stock decremented
9. Sync queue: ticket pushed to server when online
```

### Sync Architecture (Offline-First)
```
POS (SQLite)                         Server (PostgreSQL)
+----------+                         +--------------+
| Local DB |  ---- push (batch) ---> |  Central DB  |
|          |  <--- pull (catalog) -- |              |
| Sync     |                         |              |
| Queue    |  Version vectors:       |              |
| (pending |  each entity has        |              |
|  changes)|  (store_id, version)    |              |
+----------+                         +--------------+
```

## Module Dependency Graph
```
auth ----------------------------------------+
products --> stock --> audit                  |
sales --> products                           |
      --> customers                          +---> common (guards, pipes)
      --> promotions                         |
      --> audit                              |
reports --> sales                            |
ia --> products, sales, stock                |
currency --> (standalone)                    |
sync ----------------------------------------+
```

## Security Layers
1. **Transport**: HTTPS (TLS 1.3)
2. **Auth**: JWT access (15min) + refresh (7d) tokens
3. **RBAC**: admin > manager > cashier (permission matrix)
4. **Audit**: Hash-chain append-only log
5. **Data**: Passwords hashed with bcrypt, PINs hashed
6. **Input**: DTO validation via class-validator
