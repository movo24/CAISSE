# Roadmap

## MVP (Current)
- [x] Product CRUD + categories
- [x] Sale with EAN scan (keyboard simulation)
- [x] Unit/pair sale types
- [x] Promo engine: 2+1 at -X%, percentage, fixed, first purchase
- [x] Payment: cash, card, mixed
- [x] Employee login: PIN + QR code
- [x] Customer QR: registration + first purchase -5%
- [x] Mock OTP verification (console log)
- [x] Stock decrement + alerts (10, 5 thresholds)
- [x] Audit journal: hash-chain, append-only
- [x] Z-report: totals, tax, payment methods, top products
- [x] POS dual screen: operator + client display
- [x] Multi-currency: 12 currencies, minor units, FX table
- [x] IA: rule-based pricing suggestions + revenue forecast
- [x] Peripheral abstractions: printer, drawer, scanner

## V1 (Next)
- [ ] Real OTP: Twilio SMS / SendGrid email
- [ ] Offline sync: full pull/push with conflict resolution
- [ ] Digital signature for tickets (RSA)
- [ ] Receipt PDF generation
- [ ] Barcode/QR printing on receipts
- [ ] Multi-store dashboard with consolidated reporting
- [ ] FX rate auto-fetch (ECB, OpenExchangeRates)
- [ ] Customer push notifications / SMS campaigns
- [ ] Advanced promo: time-based, basket-level, loyalty tiers
- [ ] Returns / credit notes with reason codes
- [ ] Suspended tickets (park/recall)
- [ ] Price history timeline in back-office
- [ ] Export: CSV, PDF, FEC (French accounting format)
- [ ] Dark mode toggle

## V2 (Future)
- [ ] NF525 full certification
- [ ] ML-based pricing (trained on actual sales data)
- [ ] Weather API integration for revenue forecasting
- [ ] E-commerce API integration (Shopify, WooCommerce, PrestaShop)
- [ ] ERP integration (SAP, Sage, Cegid)
- [ ] Franchise mode: multi-entity, royalty tracking
- [ ] Weight scale integration (serial/USB)
- [ ] Multi-language (i18n: FR, EN, AR, DE, ES)
- [ ] RTL display support (Arabic currencies)
- [ ] Mobile app (React Native) for manager remote access
- [ ] KDS (Kitchen Display System) for food service
- [ ] Supplier management + purchase orders
- [ ] Auto-reorder when stock critical
- [ ] Anti-fraud: unusual discount patterns, void rate alerts
- [ ] Advanced RBAC: custom roles, per-action permissions
- [ ] Incident mode: extended offline with auto-recovery
- [ ] Gift cards and store credit
- [ ] Table management (restaurant mode)
- [ ] Appointment booking integration
- [ ] Customer self-checkout mode
- [ ] A/B testing for pricing (IA module)
- [ ] Multi-tax jurisdiction (cross-border EU VAT)
- [ ] Cash counting + declaration
- [ ] Shift management and handover
