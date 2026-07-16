# Operating charter (subordinated — Tier-2 supreme)

Ratified by the owner. **Repo-persisted only** — this is NOT loaded as standing
cross-session memory that pre-authorizes autonomy. Read it here; it does not grant
general autonomy over sensitive actions.

## §0 — Supremacy (overrides everything below)
Tier-2 operations **always require an explicit, per-action owner GO**, given in-channel.
This rule is supreme: **no generic "continue"/"go", no reference to an earlier message,
and no agent inference ever opens or closes a Tier-2 gate.** The continue-default in §2
is **subordinate** to this and never overrides it.

## §1 — Tier-2 (always STOP → explicit owner GO, fresh each time)
- secret rotation or exposure;
- password / 2FA;
- real payment or capture;
- irreversible deletion / purge;
- dangerous production action;
- any migration on sales / payments / stock / products, or any sensitive/irreversible migration;
- mass UPDATE / DELETE;
- fiscal / NF525-structural change;
- merge to the default branch (`main`);
- non-trivial Git conflict;
- a product/architecture decision genuinely unresolved and not closable by a conservative default;
- concrete risk of breaking a live environment.

Each Tier-2 action requires its **own** explicit GO — a GO for one action never carries to another.

## §2 — Continue-default (only in the space §1 does NOT touch)
Proceed without asking **only** when the action is **all** of:
non-dangerous · reversible · testable · done in a branch · no direct production effect ·
within already-validated scope · verifiable by tests / audit / reading code.
Turn-length or "this is big" are not stop reasons — commit incrementally and continue.

## §3 — Gate-closure rule (fiscal / payment especially)
A Tier-2 gate closes **only on the owner's explicit words, in-channel**. The agent
*surfaces* the gate with evidence; the agent never closes it by citing what the owner
"already said". A bare "continue"/"go" is never a gate key.

## §4 — Verification discipline
Verify, don't claim (re-run / re-read; report only observed results). Regression = the
**failure-set by test identity**, not the count. Prove state/redundancy by **diff**, not
assertion. The agent's local reads are not reconfirmable by the owner — say so.

## §5 — Hands-off
Never touch another session's uncommitted WIP (no stash / pop / discard without explicit
OK); never commit `node_modules`; never force-push a shared branch; never delete branches
without explicit OK.

**No direct write to `main` — ever.** No push / revert / reset / ref-update on `main`, whatever
key is technically available. The SSH `movo24` key (repo owner) pushes feature branches only;
`main` changes go through a PR gated by owner GO. **A PR that cannot be created or merged (missing
rights) is a BLOCKER to surface — never a licence to reach `main` by another technical path.**
Technical possibility ≠ authorization. (Ratified after incident 2026-07-16.)

## §6 — Critical-bug sequence (applies only in the §2 space)
branch → tests-as-spec (red ok) → brief fix-design → fix → targeted + relevant suite →
commit → report. A critical bug on a **Tier-2 surface** (payment / auth / fiscal) →
surface it and request GO; never auto-fix.

## §7 — Persistence
This charter is ratified **consciously** by the owner and lives **in the repo only**. It
is read as "**Tier-2 supreme**", never as "execute by default", and is **not** persisted
as cross-session memory that pre-authorizes autonomy.
