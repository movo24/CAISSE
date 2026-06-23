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

Override — only when the unstaged specs are intentionally separate (another WIP, or a
deliberate code-then-test split):

```sh
ALLOW_UNSTAGED_SPECS=1 git commit -m "..."
```
