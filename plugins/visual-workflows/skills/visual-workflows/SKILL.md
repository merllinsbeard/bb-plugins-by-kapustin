---
name: visual-workflows
description: Design and run visual agent workflows with independent local step profiles.
---

Use `bb visual-workflow teams` to inspect templates, `bb visual-workflow run <slug> --task "..." --parent-self` to run an authorized task, `bb visual-workflow status <runId>` to inspect progress, and `bb visual-workflow cancel <runId>` to cancel. Use `--wait` to wait for a terminal result. Never start paid provider work without a user task authorizing it.

Edit workflows and local step profiles on the Visual Workflows page. Agent Roles is optional: Import / refresh copies profiles and legacy templates, replacing only previously imported copies. It does not alter the companion's data. Removing the companion does not break copies. Provider quotas apply. No sync to local Claude agent files or Tasks presets is performed.
