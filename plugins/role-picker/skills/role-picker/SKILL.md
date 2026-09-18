---
name: role-picker
description: Choose a specialist role for the current BB thread using the composer control before the microphone.
---
Select a role, then send normally with Enter or the native submit button. The role applies to the SAME thread from the next message; a new thread starts with the role on its first message. Never spawn a child thread merely because the user selected a role. No separate dispatch button exists.

Requires Agent Roles. The role supplies instructions; the composer's provider, model, permissions, environment, attachments and mentions remain intact. “Без роли” removes the specialist persona on the next send. Existing role selection persists in Agent Roles metadata. An unsent selection is local to that composer and resets on plugin reload.

Implementation: a full-trust content script decorates native same-origin create/send requests with agent-only instructions. New threads carry Agent Roles metadata at creation; existing threads update it before sending. Failed preparation aborts normal submission. The SDK hides actions in compact layout. Recheck routes and request contracts when upgrading BB.
