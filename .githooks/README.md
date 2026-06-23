# Git hooks (`.githooks/`)

Shared, committed git hooks. They are **not** active until each clone/worktree opts in:

```sh
git config core.hooksPath .githooks
```

(Run once per clone and per git worktree — `core.hooksPath` is local config, not committed.)

## `pre-commit` — unstaged-test guard

Refuses a commit when a modified or new `*.spec.ts` / `*.test.ts` (`.tsx` too) is **not
staged**. This prevents the recurring miss where `git add <dir>` stages source but
silently drops a sibling spec in a parallel directory (e.g. `test/`), so the test ships
uncommitted (the M107 incident).

**Deliberate split** (e.g. per-module commits where sibling specs land in their own
commits) — declare every deferred spec in a **manifest**. Any flagged spec that is
neither staged nor in the manifest still blocks, so a forgotten/new spec is caught even
mid-split (a plain "disable the guard" could not do this):

```sh
ALLOW_UNSTAGED_SPECS="test/a.spec.ts test/b.spec.ts" git commit -m "..."
```

(whitespace- or comma-separated, paths exactly as git reports them).

**Legacy blanket bypass** — discouraged, reopens the M107 hole, warns loudly:

```sh
ALLOW_UNSTAGED_SPECS=1 git commit -m "..."
```
