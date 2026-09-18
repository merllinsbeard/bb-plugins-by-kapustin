---
name: usage-limits
description: Check agent-provider usage limits (weekly and other rate-limit windows) with `bb usage-limits`. Use when the user asks how much of their Claude/Codex/etc. quota is used, when a limit resets, or before scheduling heavy batches of agent work.
---

# Usage limits

The Usage Limits plugin reads provider usage windows (for example Claude's
7-day and 5-hour limits) through bb's provider bridges and shows them in the
sidebar footer. The same data is available from the shell.

## Commands

| Command | Effect |
| --- | --- |
| `bb usage-limits` | Weekly windows per provider, with used % and time until reset. |
| `bb usage-limits --all` | Every window, not only weekly ones. |
| `bb usage-limits --force` | Bypass the cache (default 5 minutes) and query providers now. |
| `bb usage-limits --json` | Machine-readable snapshot: `{ providers, fetchedAt, error }`. |

Each provider entry has `status` (`ok`, `not_installed`, `unauthenticated`,
`expired`, `error`) and, when `ok`, a `windows` array of
`{ label, usedPercent, resetsAt, weekly }`.

## Procedure

1. Run `bb usage-limits --json` when a decision depends on remaining quota.
2. Treat `usedPercent >= 80` as a warning and `>= 95` as critical; prefer
   deferring large batches until after `resetsAt`.
3. A non-`ok` status means the provider CLI needs installing or signing in on
   that host; tell the user rather than retrying.

## Total tokens across BB

The third sidebar chip (Σ) shows recorded tokens for today and the current
calendar month in the browser's timezone. Click the bar for exact totals.
`bb usage-limits --tokens [--force]` returns JSON using the server timezone.
The collector pages through all visible, hidden, and archived threads via the
SDK and persists deltas in the plugin database. Replayed cumulative snapshots
are not counted twice; cache and reasoning are not added again to provider totals.
Only token usage reported to BB is available. Permanently deleted history that
was removed before the first collection cannot be reconstructed.
