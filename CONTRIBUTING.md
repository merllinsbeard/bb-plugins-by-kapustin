# Contributing

Every plugin should solve a distinct user problem and remain independently installable.

1. Add `plugins/<id>/` with its own package.json, package-lock.json, README, PLUGIN_OVERVIEW.md and license. Use the BB scaffold and public Plugin SDK.
2. Choose the package name carefully: BB derives the installed ID from it. Preserve existing IDs during refactors.
3. Add the plugin to `.bb/plugins.json`, and to a suitable preset in `packs.json`. Declare required companion plugins in `packs.json.requires` and the README.
4. Keep source and dependency imports self-contained. Do not require another plugin's directory or a local absolute path.
5. Add truthful Community metadata and assets under `marketplace/`. Capture screenshots with demo data.
6. Run focused checks, tests and a BB build, then `npm run catalog:check`. Check changed UI in BB and verify a fresh installation before release.

The CI matrix is generated from `.bb/plugins.json`; adding a plugin does not require editing a second list in the workflow. Releases remain manual and independent.
