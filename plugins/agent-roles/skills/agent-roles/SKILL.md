---
name: agent-roles
description: Spawn specialist agent threads by role (analyst, developer, reviewer, qa, researcher, writer, …) and run multi-agent teams on a task with `bb role`.
---

# Agent roles and teams

A **role** is a reusable specialist profile: standing instructions plus an
optional default provider/model/reasoning/permission tuple. A role's
instructions never appear in the chat: a role thread gets them as hidden
system instructions, its first message is just the task, and the agent opens
with a role card (`::agent-role{slug="…"}`), which BB also shows in the
thread header. A **team** is an ordered list of stages; each stage
runs one or more roles (in parallel or one by one) and passes their outputs
to the next stage. Since the DAG update a team is a graph: every node is one
role invocation with `inputs` (node ids whose outputs it receives); nodes
whose inputs are done start immediately, so independent nodes run in
parallel. Legacy team execution remains available through the CLI for existing data. The separate Visual Workflows plugin owns the visual constructor for new workflows.

Roles are edited on the **Agent Roles** page (sidebar). Visual Workflows has its own step profiles, graphs and runs; it can import independent copies of legacy Agent Roles data. Neither plugin requires the other.

## Commands

```
bb role list                                   roles and their default models
bb role show <role>                            full instructions
bb role spawn <role> --prompt "<task>"         file a job: a Tasks record for the role, no thread yet
bb role spawn <role> --prompt "<task>" --thread [--parent-self] [--project <id>] [--title <t>] [--hidden] [--wait]
bb role chat <TASK-KEY> [--parent-self] [--wait]  open the specialist thread for a filed job
bb role tasks                                  open role jobs
bb role teams                                  team templates with their stages
bb role run <team> --task "<task>" [--parent-self] [--project <id>] [--hidden] [--wait]
bb role runs                                   recent team runs
bb role status <runId>                         stage/step progress, thread ids, outputs
bb role cancel <runId>
bb role sync [--status] [--json]               reconcile roles ↔ agent files ↔ Tasks presets
```

`<role>` / `<team>` accept slug, id, or exact name. Inside a thread the
project and environment are taken from the current thread; the spawned
threads share your workspace.

## How to delegate

- File a job for a human to pick up later: `bb role spawn reviewer --prompt "…"`.
  This creates a Tasks record labelled `role:reviewer` (title `[Reviewer] …`)
  and prints a `::task{key="…"}` card; no thread runs until someone opens a
  chat from it (Roles page → Jobs → *Chat with Reviewer*, or `bb role chat KEY`).
  The thread is attached to the task, the task moves to `in_progress`, and
  every answer the agent produces is posted on the task as a comment.
- One specialist right now: `bb role spawn reviewer --prompt "Review the diff in HEAD~1" --thread --parent-self`,
  then `bb thread wait <id>` and `bb thread output <id>`. `--wait` does both
  and prints the output. Add `--task KEY` to attach it to an existing task.
- Several specialists at once: spawn each with `--thread --parent-self`, then
  wait on all of them. Their lifecycle notifications reach you as the parent.
- A staged pipeline: `bb role run feature --task "…" --parent-self`; poll
  `bb role status <runId>` (or `--wait`). The run's final output is the last
  stage's combined output.

Always pass `--parent-self` when you delegate from a thread so the work is
attributed to you and shows up under your thread.

## Writing good tasks

- Give the specialist the concrete inputs: paths, branch, URLs, the plan.
- State the expected output shape (list of findings, a patch, a brief).
- Node prompts support `{task}`, `{inputs}` (outputs of the node's inputs,
  labelled), `{all}` (everything finished so far) and `{<nodeId>}` for one
  specific node's output.
- The separate Visual Workflows editor can show its graph as a builtin BB workflow script
  (`Show as bb workflow script` → copy to `.bb/workflows/<name>.js`) for
  durable, resumable runs via `bb workflows run`.

## One role, three surfaces

Synchronization is off by default. When `syncEnabled` is enabled and the agent
directory is configured, each role is mirrored after edits and on a periodic
pass to:

- a **Claude Code subagent file** `~/.claude/agents/<slug>.md` — standard
  frontmatter (`name`, `description`, `model`, `tools`) plus a `bb:` block
  (`title`, `provider`, `model` for non-Claude providers, `reasoning`,
  `permission`, `color`). Claude Code reads the file as an ordinary subagent;
- a **Tasks delegation preset** named after the role, so
  `bb tasks dispatch ABC-12 --preset "Reviewer"` runs the task as that
  specialist. Fields a role inherits get the plugin's "Preset default …"
  settings.

Edit whichever surface is handy — the Roles tab, the Tasks preset editor, or
the file — and the other two follow. When two sides changed since the last
sync, the role wins over the file (newer of the two by timestamp) and both
win over the preset. Deleting a role or its file deletes the other two; a
deleted preset is recreated. Preset-only fields (environment, base branch,
machine, service tier) are left alone. `bb role sync` forces a pass and
prints what changed; `--status` shows the last report.

## Constraints

- Worker threads run with the role's permission mode, capped by the parent's.
- A step fails if its thread errors or exceeds the plugin's step timeout
  (setting, default 45 min); the run then fails and pending steps are cancelled.
- Roles referenced by a team must exist; deleting a role breaks those teams.

## Optional Visual Workflows companion

The following canvas controls belong to the independently installed Visual Workflows plugin. Agent Roles keeps its legacy CLI and records for compatibility. In Visual Workflows, teams open in a popup. Add an agent step from the canvas toolbar or the + beside a node. Connect output/input ports by dragging or clicking. Select a line to remove it; select a node to edit its prompt, role, dependencies and final-output setting. Moving nodes saves optional `position: { x, y }` coordinates with the graph; coordinates never change execution dependencies. Auto layout clears positions. Invalid cycles are rejected before changing the draft. Save persists changes; Cancel/Close discards them.

Existing arrows can be reconnected by dragging the line or destination input port. Selecting an arrow exposes handles for either end; drag a handle onto another step. Drops outside and Escape cancel, and invalid connections preserve the old edge. Both mouse and touch use pointer capture and a live preview.
