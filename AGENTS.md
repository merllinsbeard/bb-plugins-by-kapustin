# BB Plugins by Kapustin

Publisher: dmitriikapustin. Repository: dmitriikapustin/bb-plugins-by-kapustin.

- Each directory in plugins/ is an independently installable BB plugin. Read its README before editing.
- Preserve existing package names and derived plugin IDs, settings and stored data.
- Use .bb/plugins.json as the inventory; update packs.json and marketplace drafts when adding a plugin.
- Keep every plugin installable without sibling node_modules or workspace-only dependencies. Bundle shared code before distribution.
- Run node scripts/run.mjs check NAME, test NAME, and build NAME after changing a plugin. Run npm run catalog:check for metadata changes.
- Reload an existing local plugin only after checking its source path. This repository initially contains release copies; active development plugins may still point to sibling directories.
- Authenticate publishing with the separate gh-bb profile. Never switch the default gh account or change global Git credentials.
- Use independent immutable tags: NAME/vX.Y.Z. Do not publish main as the stable install source.
- Do not commit credentials, runtime data, local logs, node_modules, or private screenshots.
- Do not overwrite concurrent changes. Prepare a concrete release plan before asking for approval to push or publish.
