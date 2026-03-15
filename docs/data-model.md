# Data Model

## Entity Relationship Diagram

```
stores
+-- id (UUID, PK)
+-- name
+-- address
+-- currency_code (ISO 4217)
+-- timezone
+-- tax_id
+-- is_active

employees
+-- id (UUID, PK)
+-- store_id (FK -> stores)
+-- first_name, last_name
+-- email
+-- pin_hash
+-- qr_code (unique)
+-- role (admin|manager|cashier)
+-- max_discount_percent
+-- is_active

products
+-- id (UUID, PK)
+-- store_id (FK -> stores)
+-- ean (indexed)
+-- name
+-- category_id (FK -> product_categories)
+-- unit_type (unit|pair|kg|meter|liter)
+-- price_minor_units (integer)
+-- cost_minor_units (integer, nullable)
+-- currency_code
+-- tax_rate (decimal)
+-- image_url
+-- stock_quantity
+-- stock_alert_threshold (default 10)
+-- stock_critical_threshold (default 5)
+-- is_active

product_categories
+-- id (UUID, PK)
+-- name
+-- parent_id (self FK, nullable)
+-- store_id (FK -> stores)

customers
+-- id (UUID, PK)
+-- store_id (FK -> stores)
+-- first_name, last_name
+-- phone, email
+-- qr_code (unique)
+-- loyalty_points
+-- is_first_purchase (bool)
+-- is_verified (bool)
+-- created_at

sales
+-- id (UUID, PK)
+-- store_id (FK -> stores)
+-- employee_id (FK -> employees)
+-- customer_id (FK -> customers, nullable)
+-- status (pending|completed|voided|suspended)
+-- subtotal_minor_units
+-- discount_total_minor_units
+-- tax_total_minor_units
+-- total_minor_units
+-- currency_code
+-- ticket_number (sequential per store)
+-- hash_chain_prev
+-- hash_chain_current
+-- created_at
+-- completed_at

sale_line_items
+-- id (UUID, PK)
+-- sale_id (FK -> sales)
+-- product_id (FK -> products)
+-- product_name (denormalized)
+-- ean
+-- quantity
+-- unit_price_minor_units
+-- discount_minor_units
+-- promo_id (FK -> promo_rules, nullable)
+-- tax_rate
+-- line_total_minor_units

sale_payments
+-- id (UUID, PK)
+-- sale_id (FK -> sales)
+-- method (cash|card|mixed)
+-- amount_minor_units
+-- currency_code
+-- reference

promo_rules
+-- id (UUID, PK)
+-- store_id (FK -> stores)
+-- name
+-- type (buy_x_get_discount|percentage|fixed_amount|first_purchase)
+-- buy_quantity
+-- discount_percent
+-- discount_fixed_minor_units
+-- applicable_product_ids (JSON array)
+-- applicable_category_ids (JSON array)
+-- start_date, end_date
+-- is_active

audit_entries
+-- id (UUID, PK)
+-- store_id (FK -> stores)
+-- employee_id (FK -> employees)
+-- action (enum)
+-- entity_type
+-- entity_id
+-- details (JSONB)
+-- previous_hash
+-- current_hash
+-- timestamp

price_history
+-- id (UUID, PK)
+-- product_id (FK -> products)
+-- old_price_minor_units
+-- new_price_minor_units
+-- changed_by (FK -> employees)
+-- reason
+-- changed_at

fx_rates
+-- id (UUID, PK)
+-- base_currency
+-- quote_currency
+-- rate (decimal)
+-- source
+-- timestamp

z_reports
+-- id (UUID, PK)
+-- store_id (FK -> stores)
+-- date
+-- employee_id (FK -> employees)
+-- total_revenue_minor_units
+-- total_tax_minor_units
+-- currency_code
+-- cash_total_minor_units
+-- card_total_minor_units
+-- transaction_count
+-- average_basket_minor_units
+-- top_products (JSONB)
+-- void_count
+-- discount_total_minor_units
+-- peak_hours (JSONB)
+-- created_at

sync_queue (local SQLite only)
+-- id (integer, PK, auto)
+-- entity_type
+-- entity_id
+-- action (create|update|delete)
+-- payload (JSON)
+-- synced (bool)
+-- created_at
```

## Indexes
- `products.ean` + `products.store_id` (unique composite)
- `sales.store_id` + `sales.created_at`
- `sale_line_items.sale_id`
- `audit_entries.store_id` + `audit_entries.timestamp`
- `customers.qr_code` (unique)
- `employees.qr_code` (unique)
- `employees.store_id` + `employees.pin_hash`
