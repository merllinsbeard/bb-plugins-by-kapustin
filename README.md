# BB Plugins by Kapustin

A growing collection of focused plugins for [BB](https://getbb.app), maintained by [Dmitrii Kapustin](https://github.com/dmitriikapustin).

Install the tools you need individually, or choose a preset. Each plugin has its own version, settings and release tags.

**Status:** initial release preparation. Installation commands require this repository and the corresponding release tags to be published. Community entries in `marketplace/` are submission drafts, not proof of acceptance.

## Plugins

| Plugin | What it adds | Requirements |
| --- | --- | --- |
| [My Tasks](plugins/my-tasks/README.md) | Personal checklists, nested steps and optional agent assistance | Codex authentication for agent assistance |
| [Goals](plugins/goals/README.md) | Personal priorities agents can consult when asked | BB |
| [Usage Limits](plugins/usage-limits/README.md) | Provider quota windows and reset times | A provider reporting usage limits |
| [Agent Roles](plugins/agent-roles/README.md) | Specialist profiles and visual team workflows | Configured providers for agent runs |
| [Role Picker](plugins/role-picker/README.md) | Apply a specialist role in the current composer | Agent Roles enabled |
| [Autopilots](plugins/automation-groups/README.md) | Folders and group controls for scheduled work | Bundled Automations plugin |
| [Uptime](plugins/uptime/README.md) | Website availability and latency monitoring | Network access to your websites |

Current packages require BB 0.43+ and Plugin SDK 0.4.87+. Some plugin interfaces are currently in Russian. Agent assistance uses your provider's quota.

## Install one plugin

After the first release is published:

```sh
bb plugin install 'git:https://github.com/dmitriikapustin/bb-plugins-by-kapustin.git@^0.1.0' --plugin goals --tag-prefix goals/
```

Each plugin uses its own compatible version range. My Tasks starts at `^0.3.0`; the other initial plugins start at `^0.1.0`. Role Picker needs Agent Roles first. Installation and updates remain explicit user actions.

```sh
bb plugin outdated
bb plugin update goals
```

## Install a preset

Clone the repository, then preview an installation plan:

```sh
git clone https://github.com/dmitriikapustin/bb-plugins-by-kapustin.git
cd bb-plugins-by-kapustin
node scripts/install-pack.mjs essentials
```

Presets: `essentials` (My Tasks, Goals, Usage Limits), `agents` (Agent Roles, Role Picker), `operations` (Autopilots, Uptime), or `all`. A single plugin ID also works. The script includes required companions automatically and orders them before dependents.

To execute the plan, append `--apply`. BB asks for confirmation for each plugin. No root npm install is needed; the script uses Node built-ins. An already installed plugin stops the installer: use `bb plugin update <id>` for that plugin and install the remaining selections individually.

## Development

Use Node 22.19+ (or 24/26) and the BB CLI. Dependencies and lockfiles live inside each plugin, so every package can be checked and installed independently.

```sh
npm run deps
npm run verify
```

For a single plugin:

```sh
node scripts/run.mjs deps goals
node scripts/run.mjs check goals
node scripts/run.mjs test goals
node scripts/run.mjs build goals
```

`verify` checks the collection, metadata, types, existing test suites and BB builds. CI performs the same checks for each plugin. Changes are not automatically published.

## Releases and contributions

See [RELEASING.md](RELEASING.md) for independent versioning and Community submissions, and [CONTRIBUTING.md](CONTRIBUTING.md) for adding plugins. Stable releases use immutable tags such as `goals/v0.1.0` and `my-tasks/v0.3.0`.

The shared repository does not require installing the whole collection. Shared libraries, when added, must be bundled into each plugin rather than relying on sibling packages at runtime.

MIT licensed. Existing copyright notices are preserved.
