# Agent Roles

BB plugin for reusable agent profiles, Tasks jobs, and workflows of connected agent steps.

## Editing workflows

Open Agent roles → Teams → New team or Edit team. The editor opens in a centered popup.

- Choose an agent and add a step, or use + beside a step to add a connected successor.
- Drag an output port to an input port. Alternatively click an output, then an input.
- Drag an existing arrow or its destination input port to reconnect it. Select a line to reveal handles for moving either end. Drop on a card or near its port; valid destinations highlight and the preview snaps to the port.
- Drop on empty canvas or press Escape to cancel a move. Invalid connections leave the original intact.
- Select a line and choose Remove connection, or press Delete.
- Select a step to edit its agent, label, prompt, dependencies and final-output flag.
- Drag empty canvas with the left mouse button to pan in any direction; Fit recenters the graph.
- Drag cards to arrange the graph. Positions persist on Save. Auto layout resets manual positions.
- Right-click a step card and choose **Delete step**, or duplicate/delete the selected step using the toolbar. Deleting a step also removes its connected edges.
- The workflow editor fills nearly the entire window; drag the canvas bottom edge to adjust its height. Zoom spans 5–400% using the slider or +/−; click the percentage to reset to 100%, or Fit to show the graph. Cycles and self-links are rejected.
- Save persists the draft. Cancel, Close or Escape discard it; clicking outside does not close it.

Agent profiles use the same popup pattern. Roles remain synchronized with Claude agent files and Tasks presets; workflow runs use the existing scheduler.

## Development

```
npm install --include=dev
node --experimental-strip-types --test shared.test.ts
npx tsc --noEmit
bb plugin build .
bb plugin reload agent-roles
```


## Optional synchronization

Local Claude agent files and Tasks presets are not imported or modified by default. Enable the `syncEnabled` setting only when you want two-way synchronization. Configure `agentsDir` and provider defaults first. Role Picker is a separate optional companion for selecting roles in the composer.
