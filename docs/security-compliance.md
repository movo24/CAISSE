# Security & Compliance

## NF525 Compliance Path (France)

NF525 is the French certification for POS software ensuring fiscal data integrity.

### What the MVP implements:
- [x] **Hash-chain audit log**: Each ticket is SHA-256 linked to the previous (append-only)
- [x] **Immutable journal**: Audit entries cannot be modified or deleted
- [x] **Sequential ticket numbering**: Per-store sequential numbering with no gaps
- [x] **User identification**: Every action linked to an authenticated employee
- [x] **Z-report**: End-of-day closure with all required totals

### What's needed for full NF525 (V1/V2):
- [ ] **Digital signature**: RSA/ECDSA signature per ticket (not just hash)
- [ ] **Signature rotation**: Key management, HSM integration
- [ ] **Certified export**: JET (Journal Electronique des Transactions) format
- [ ] **Archival**: 6-year retention with integrity verification
- [ ] **Grand Total counters**: Perpetual, non-resettable counters
- [ ] **Certification audit**: Third-party audit by accredited body (e.g., INFOCERT, LNE)
- [ ] **Training mode**: Clearly separated from production data

## Authentication & Authorization

### JWT Strategy
- Access token: 15-minute expiry, contains employee ID, store ID, role
- Refresh token: 7-day expiry, stored server-side, revocable
- PIN: 4-6 digits, bcrypt-hashed, max 3 attempts then 15-min lockout
- QR code: Unique per employee, acts as username (still requires PIN)

### RBAC Matrix

| Action | Admin | Manager | Cashier |
|--------|-------|---------|---------|
| Create/edit products | Yes | Yes | No |
| Change prices | Yes | Yes | No |
| Apply manual discount | Yes | Up to max% | Up to max% |
| Void a sale | Yes | Yes | No |
| View reports | Yes | Yes | No |
| Manage employees | Yes | No | No |
| Manage stores | Yes | No | No |
| Manage promos | Yes | Yes | No |
| Process sale | Yes | Yes | Yes |
| Open drawer | Yes | Yes | With log |

## Data Protection (GDPR)
- Customer data: name, phone, email collected with consent
- Right to deletion: customer data can be anonymized
- Data minimization: only collect what's needed
- PINs and passwords: never stored in plaintext
- Audit logs: contain employee IDs, not personal data (linked via FK)

## TVA (French VAT)
Supported rates:
- 20% (standard)
- 10% (reduced: restaurants, etc.)
- 5.5% (essential goods)
- 2.1% (press, medicines)
- 0% (exempt)

Multi-rate support: each product has its own tax_rate.
Z-report breaks down revenue by VAT rate.
