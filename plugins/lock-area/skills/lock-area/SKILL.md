---
name: lock-area
description: Inspect or initialize compatible native BB pane locking with explicit host paths and backup.
---

Prefer existing native Lock pane / Unlock pane controls. Do not initialize if those already work.

The optional initializer supports BB 0.43.1 source commit 00d1b88c205845015c9fef588aab375452ba38e3 only. Read the plugin README first. Use a separate clean source checkout with dependencies installed, Node 22.19+ and pnpm. Run bb lock-area check with --host, --checkout and --target (absolute paths). Initialization uses the same arguments and modifies the checkout and installed frontend; do it only when the user requests this enhancement. Preserve the returned backup path.

The restore command takes the same paths plus --backup ABSOLUTE_PATH and refuses to overwrite a changed installation. Never bypass version, cleanliness or hash checks. Do not restart BB or agents; refresh the frontend after deployment.
