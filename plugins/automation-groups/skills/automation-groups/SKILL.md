---
name: automation-groups
description: Group BB automations into named folders and pause, resume or run a whole group with `bb automation-group`.
---

# Automation groups

Automations live in the builtin `automations` plugin (`bb automation …`).
This plugin adds a grouping layer on top: named, colored groups that span
projects, plus bulk pause / resume / run per group. Groups never change an
automation's own schedule or execution — they only organize.

## Commands

```
bb automation-group list [--json]                 groups with their automations
bb automation-group create <name> [--color <c>]   colors: gray red orange amber green teal blue violet pink
bb automation-group rename <group> <new name>
bb automation-group color <group> <color>
bb automation-group delete <group>                members become ungrouped
bb automation-group assign <automationId> <group>
bb automation-group unassign <automationId>
bb automation-group pause <group>                 pause every member
bb automation-group resume <group>                resume every member
bb automation-group run <group>                   run every member now
bb automation-group runs <automationId> [--limit <n>] [--json]   run history + health
bb automation-group background <automationId> on|off             one hidden thread for all runs
```

`runs` reports a health block: succeeded/failed/skipped counts over the
window, `consecutiveFailures` (newest-first streak), the last error text and
average duration. Use it to answer "is this automation failing?".

`background on` makes an **agent** automation re-prompt one dedicated hidden
thread on every run (the automations plugin's target-thread feature) instead
of spawning a new sidebar thread each time. `off` restores fresh-thread runs
in the automation's configured environment; the hidden thread is kept. Script
automations never create threads, so the flag is rejected for them.

`<group>` is a group id (`grp_…`) or its exact name (case-insensitive).
Automation ids come from `bb automation list --project <id>` or
`bb automation-group list`.

## When to use

- The user asks to organize, tag, fold, or batch automations.
- Pausing or resuming a related set of automations at once ("pause all
  the Kaiten sync jobs").
- A "Create a new bb automation to …" prompt that ends with an instruction
  to add it to a group: create the automation with `bb automation create`,
  then `bb automation-group assign <automationId> "<group>"`.
- After creating several related automations with `bb automation create`,
  put them in a group so the UI page (sidebar → Automation groups) stays
  readable.

- The user asks whether an automation is failing, wants its run history,
  or wants to see what a run did: `bb automation-group runs <id>`; each
  agent run lists its thread id (`bb thread show <id>` for the transcript).
- The user complains about automation threads cluttering the sidebar:
  `bb automation-group background <id> on`.

## Constraints

- Deleting a group never deletes automations.
- `run` starts every member immediately and skips nothing; confirm with the
  user before running a large group.
- Memberships of deleted automations are pruned automatically on the next
  `list`.
