# SwarmForge guide

## Why several roles?

A browser game mixes rules, rendering, input, sound, accessibility, release packaging, and deployment. SwarmForge assigns these concerns to explicit roles and isolated git worktrees so contributors can review one another without editing the same checkout.

## Prerequisites

- `zsh`, `git`, and `tmux`
- Babashka (`bb`)
- one configured agent backend, such as Codex CLI
- Node.js 22 or newer for this repository

Run `./swarm`. The first configured window (`director`) owns cleanup and uses the main checkout. Other roles use `.worktrees/<role>`.

## Handoff example

After a gameplay slice is committed, create a SwarmForge handoff draft:

```text
type: git_handoff
to: presentation
priority: 20
task: render-valid-swap-events
commit: 0123456789
```

Queue it with `swarm_handoff.sh draft.txt`. The receiver uses `ready_for_next.sh`, reviews the exact commit, and completes the task with `done_with_current.sh`.

## Rules that keep the project understandable

1. Core rules never import browser APIs.
2. Every behavioral change starts with a focused failing test.
3. Presentation consumes state and events; it does not invent scoring rules.
4. QA verifies the public browser surface and records evidence.
5. Only the director merges verified commits and makes release claims.

## Troubleshooting

- `tmux: command not found`: install tmux before running `./swarm`.
- no terminal windows open: set `SWARMFORGE_TERMINAL=none ./swarm` and attach in the current shell.
- downloaded scripts look stale: remove the ignored `swarmforge/scripts/` directory and restart.
- a test fails in one worktree only: ensure the handoff commit was merged and run `npm test` from that worktree root.
