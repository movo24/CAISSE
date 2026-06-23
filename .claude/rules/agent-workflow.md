# Agent workflow & verification discipline (mandatory)

How to deliver work so green means correct and nothing is lost. Hard-won lessons.

## Verify, don't claim
- "Done" requires an observed result. Re-run tests / re-read code; report only what the run showed.
- Prefer data over assertion (e.g. scan the domain to prove a bug), and observable RED over an
  agent's opinion (revert the fix, watch the test fail, restore).

## Tests-as-spec + mutation gate
- For a bug: write the test that proves it first (RED), then fix to GREEN.
- **Green ≠ load-bearing.** A machine-generated test sweep runs ~5% tautological. After any
  sweep, run a mutation/break-test: break each load-bearing path, confirm the spec turns RED;
  a survivor = a weak/missing assertion to harden. Prove each fix: green → re-apply mutation →
  red → revert → green. (See memory: mutation-gate-on-sweeps.)
- Watch for: unconditional defaults asserted as if conditional; self-validating round-trips;
  exact in-SQL-arithmetic assertions on pg-mem; untested store/tenant scoping.

## Do not lose work (critical)
- **Never `git checkout -- <file>` to "restore" after a break-test if your fix is uncommitted**
  — checkout reverts to the committed (unfixed) baseline and destroys the fix. Always **commit
  the fix first**, then break-test (checkout then restores the committed-fixed version), or
  save/restore by copy.
- Commit incrementally on large changes to protect progress.

## Isolation & environment
- Work in dedicated branches; never on the default branch. Source-behavior changes go on their
  own branch, isolately reviewable (don't bury a behavior fix in a coverage/test PR).
- For parallel mutation/break-tests, use one git worktree per target so mutations can't
  contaminate each other. Symlink `node_modules` to the shared store; **never run `npm install`
  in a worktree** (it breaks the shared symlinked store).
- pg-mem caveats: mistypes in-SQL integer arithmetic as string concat; decimals hydrate as
  strings on real Postgres. Assert direction/wiring on pg-mem; gate exact numeric/concurrency
  proofs to real-Postgres `*.pg.spec.ts`.

## The pre-commit spec guard
- `.githooks/pre-commit` blocks a commit when a modified/new `*.spec.ts` is unstaged (the M107
  miss). Activate per clone/worktree: `git config core.hooksPath .githooks`.
- For a deliberate per-module split, declare deferred specs in a manifest:
  `ALLOW_UNSTAGED_SPECS="test/a.spec.ts test/b.spec.ts" git commit ...` — a spec not staged and
  not listed still blocks. `=1` is a discouraged blanket bypass.

## Merges
- Merges are owner-gated (one click). Verify merge-order empirically (test-merge in a throwaway
  worktree) rather than assuming git dedups cherry-picked commits.
