# Active workspace

The founder designated `C:\Projects\ArtSoul` as the single active implementation
workspace on 2026-09-23. All agents and local checks for this task now use it.
The working branch is `codex/takeover-audit`; the preserved implementation commit
is `25917f09edaa683b22049989d23600e5ad8d9d1f`.
The September 27 stabilization release is
`81627ab5d5d5f17ed190aad352e56af701f724c5`, merged through PR #280 and deployed
after green Linux/Windows CI and preview acceptance. This folder fast-forwarded
to the exact merge through Git. Subsequent local work is recorded separately in
the checkpoint; a local commit does not imply another production rollout.

The earlier `.codex/worktrees/artsoul-takeover-audit/ArtSoul` directory was a Git
worktree of this same repository. It isolated the takeover from the older main
checkout and its uncommitted state. It was not another remote or deployment.

## Verified consolidation

- The original checkout was on `codex/artwork-cold-load-restoration-v2` at
  `7b982ee3f574d1683c55cb76c658203f5f71e156`. Its HEAD is an ancestor of the checked
  `main` at `607f21337941fc1bd98a3651fde8953b981d5f91`, 47 commits behind with no
  divergent commits. The remote still returned this main SHA on 2026-09-23.
- The three tracked dirty files differed only in line endings. Byte copies,
  both checkout statuses, binary Git patches and new source files were backed
  up outside the public repository before any switch. Unfamiliar untracked files
  and historical worktrees were left intact.
- The verified takeover changes were saved in local commit `25917f0`. The former
  worktree was detached at that commit, freeing the branch; the main checkout
  switched to that exact branch through Git. No source-tree overlay, merge,
  cherry-pick, hard reset, clean or remote write was used.
- All 77 implementation/test files from the previous evidence manifest matched
  after normalizing line endings. All 86 evidence files copied without overwriting
  a destination file or encountering a conflict. Machine-readable evidence is
  `output/audit/workspace-consolidation.json`.
- Windows refused to relocate the former worktree (`Permission denied`). It was
  left intact, detached and explicitly locked as archived. Its archive marker
  points here. No unknown process was terminated to force a directory move.

The recovery snapshot is under the user's private Codex audit-evidence directory,
`workspace-consolidation-2026-09-23`. That location is a backup, not a build target.
Old branches/worktrees remain historical records; do not resume implementation
inside them. Generated evidence and local configuration are not automatically
included in public commits.

## Continuing safely

1. Start from this folder and read `docs/audits/STABILIZATION_CHECKPOINT.md`.
2. Check branch/HEAD/status before editing. Keep concurrent agents on disjoint files.
3. Reconcile an existing function before introducing another implementation.
4. Preserve work before a branch change. Do not merge a historical worktree simply
   because it contains an unfinished file.
5. A local commit or green test is not deployment approval or Phase A acceptance.
