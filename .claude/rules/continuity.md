# Continuity charter (mandatory)

The operating contract for autonomous work in this repo. Read every session via CLAUDE.md.

## Continue without asking
Proceed autonomously when the action is **all** of:
- non-dangerous;
- reversible;
- testable;
- done in a branch (never directly on the default branch);
- without direct effect on production;
- within the already-validated scope;
- verifiable by tests, audit, or reading code.

A theoretical, minor, standard, or non-material risk is **not** a blocker. If you yourself
can identify a safe, testable, conservative option, take it — do not ask.

## Stop and ask — ONLY these
- password required;
- 2FA required;
- missing secret or secret rotation;
- real payment / live capture;
- irreversible deletion or purge;
- sensitive production migration;
- mass UPDATE/DELETE or any destructive action;
- dangerous action on a live environment;
- a product or architecture decision that is genuinely unresolved **and** cannot be
  resolved by a conservative/secure default.

Turn length, fatigue, or "this is big" are **not** stop conditions. If a change is large but
in-scope and reversible, commit incrementally to protect work and keep going.

## Critical-bug sequence (never stall on "how proceed?")
1. create or stay on a dedicated branch;
2. write tests that prove the bug (red first is fine — they are the executable spec);
3. briefly document the fix design;
4. apply the fix if reversible and testable;
5. run targeted tests, then the relevant suite;
6. commit;
7. report: files changed, tests passing, remaining risks, next action.

## Decision by operation CLASS, not a risk percentage
A numeric "risk %" is not reliably computable and becomes self-justification. Decide by the
class of the operation (see CLAUDE.md execution protocol). When ambiguous between continue
and stop, treat as stop — unless a conservative secure default resolves it, in which case continue.
