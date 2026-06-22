---
name: information
description: Use this skill in POS Caisse to execute validated modules autonomously, protect fiscal/payment/stock invariants, avoid unnecessary validation requests, and continue until a real blocker appears.
---

# Information Skill — POS Caisse Execution Protocol

You are operating in POS Caisse autonomous execution mode.

POS Caisse is the point-of-sale and cash register system.

It handles:

- sales;
- products;
- variants/SKU;
- store-specific prices;
- brands;
- suppliers;
- stock;
- terminals;
- sessions;
- payments;
- coupons;
- responsible-code discounts;
- audits;
- synchronization.

It may integrate with TimeWin24 only where employee identity, planning, presence, rights, cash-opening authorization or store operations are directly linked.

It must not embed accounting logic. Comptamax24 remains a separate SaaS and may only consume POS data through controlled APIs, events or exports.

## Core rule

If an action is:

- within the already validated POS Caisse scope;
- technically standard;
- reversible;
- testable;
- non-destructive;
- consistent with repository standards;
- estimated below 60% risk;

then execute it directly.

Do not interrupt the user for validation.

## Decision threshold

- If estimated risk is below 60%, continue without asking for validation.
- If estimated risk is 60% or above, stop and request explicit confirmation.
- Theoretical, minor, standard, or non-material risks are not blockers.
- If you identify an option yourself as recommended, safe and testable, execute it directly.

## POS Caisse mandatory business rules

- Variants/SKU are supported.
- Store-specific prices are supported.
- Brands and suppliers are supported.
- Promo codes are supported.
- Store employees cannot apply free internal discounts.
- Discounts are allowed only through responsible codes.
- Responsible-code discounts are capped at 30%, never more.
- Offline or partial card payment must never be marked as paid until the card payment is actually captured.
- Sales may continue during degraded payment flow, but card settlement must be regularized later.
- Negative stock discrepancy around 20% must trigger a manager alert for physical verification and validated correction.
- Duplicate events are forbidden.
- Sensitive write paths must be idempotent where duplicate execution would create inconsistent state.

## Fiscal/payment/stock invariants

Never break these invariants:

- A card payment is not paid until captured.
- A sale must not be fiscally finalized with false payment state.
- A discount above 30% is forbidden.
- A store employee cannot bypass responsible-code rules.
- Stock corrections require traceability.
- Sync must not create duplicate sales, duplicate payments or duplicate stock movements.
- Audit logs must reflect committed business operations, not phantom failed transactions.

## Stop only for real blockers

Ask for explicit human validation only if one of these applies:

- irreversible deletion or purge;
- secret rotation or secret exposure;
- dangerous production action;
- payment, 2FA, password, or missing credential;
- genuinely unresolved product or architecture decision;
- major functional change affecting the business;
- concrete risk of breaking a live environment;
- concrete risk of losing work or corrupting data.

## Required working loop

For each module or increment:

1. State the module/increment you are taking.
2. Read the relevant code before editing.
3. Implement the smallest complete safe change.
4. Audit your own implementation.
5. Run required validation:
   - typecheck;
   - lint;
   - tests;
   - build if applicable;
   - runtime verification if relevant.
6. Fix failures.
7. Commit with a clear message.
8. Briefly document what was done and what was verified.
9. Move automatically to the next validated item.

Default behavior: execute, verify, document, continue.
