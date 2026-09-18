---
name: my-tasks
description: Work with the Apple Style Tasks personal checklist: read a task and suggest steps for the user to choose. Use when the user asks about Apple Style Tasks or provides one of its task IDs.
---

# Apple Style Tasks

This is the user's personal list. Do not mark personal tasks complete or create BB threads for this plugin's actions.

Open `/plugins/my-tasks/checklist`. Tasks open in a centered dialog and have no due dates. Use Sections to create or rename sections and choose their icons. Choose a task's section inside its dialog. Deleting a section moves its tasks to the Inbox. Trash supports restoration.

Explore the idea, Break into steps, and Help with this run through background ephemeral Codex exec using `gpt-6-astra` with low reasoning effort. They create no BB threads. Work continues after the dialog closes; results, suggestions, errors and Stop remain attached to the task. Assistance is also available for an individual step. Accepted suggestions for a subtask become its child steps. Never redirect a request about one subtask to the whole parent task.

Assistance returns text and may research available data with tools. Execution is read-only and makes no external changes. When information is missing, the result asks a question; the user can clarify and run assistance again. Work interrupted by a restart shows an error and does not retry automatically. Queued work persists. An authenticated Codex CLI must be available on a connected host.

## CLI

- `bb my-tasks list` returns the latest 100 tasks as JSON, including ID, title, sectionId and completion.
- `bb my-tasks get <id>` reads context, steps, suggestions and background results.
- `bb my-tasks add <title>` adds a task to the Inbox; use only when the user asks.
- `bb my-tasks propose <id> '<JSON-array-of-strings>'` suggests 1–50 root steps of up to 500 characters each. Root suggestions are replaced; subtask suggestions remain. The built-in assistant returns structured results directly.

Quote shell arguments. For arbitrary text, use a subprocess argument array without shell=True. Data is stored in the plugin's SQLite database. Earlier linked conversations remain as references; new assistant actions create none.
