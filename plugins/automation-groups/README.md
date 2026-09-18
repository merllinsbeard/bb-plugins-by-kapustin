# bb-plugin-automation-groups

Group BB automations into named, colored folders. One page in the sidebar
(**Automation groups**) is meant to be your main automations view: every
automation across projects, search and project filter, **New automation**
(drops you into a seeded thread like the builtin page; the per-group `+`
also tells the agent which group to file it in), and a link to the builtin
template browser. Drag rows between groups or pick a group per row. Group
headers pause, resume or run every member at once. Clicking a row opens the
builtin detail/edit page.

The plugin stores only group metadata and membership in its own SQLite
database. Automations themselves stay in the builtin `automations` plugin and
are read/controlled through its RPC, so the builtin Automations page remains
the place to create and edit them.

Clicking a row opens the plugin's own detail page: health strip (success
rate, failed/skipped counts, failure streak with the last error, average
duration), the run history with per-run error/output, and the full agent
transcript inline (`ThreadChat`) for agent runs. A **Run in background**
toggle moves an agent automation onto one dedicated hidden thread so runs
stop creating sidebar threads.

## CLI

```
bb automation-group list [--json]
bb automation-group create <name> [--color <color>]
bb automation-group rename <group> <new name>
bb automation-group color <group> <color>
bb automation-group delete <group>
bb automation-group assign <automationId> <group>
bb automation-group unassign <automationId>
bb automation-group pause|resume|run <group>
bb automation-group runs <automationId> [--limit <n>] [--json]
bb automation-group background <automationId> on|off
```

## Develop

```
npm install --include=dev --ignore-scripts
bb plugin install .
bb plugin dev
```
