// bb-plugin-automation-groups — backend entry.
//
// Groups are a thin layer over the builtin automations plugin: this plugin
// stores only group metadata and automation→group membership in its own
// SQLite database. Automation records themselves are read (and paused,
// resumed, run) through the automations plugin's public RPC over the server's
// loopback URL, so nothing is duplicated and the builtin Automations page
// stays the source of truth.
//
// Three surfaces share one store: the Automation groups page (app.tsx), the
// `bb automation-group` CLI command, and the skill in skills/automation-groups
// that tells agents how to use that command. Every write publishes a realtime
// signal so open pages refetch.
import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

import { GROUP_COLORS, GROUP_NAME_MAX, GROUPS_CHANGED, type GroupColor } from "./shared";

const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.enum(GROUP_COLORS),
  collapsed: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Group = z.infer<typeof groupSchema>;

const triggerSchema = z.discriminatedUnion("triggerType", [
  z.object({
    triggerType: z.literal("schedule"),
    cron: z.string(),
    timezone: z.string(),
  }),
  z.object({ triggerType: z.literal("once"), runAt: z.number() }),
]);

// The subset of an automation record this plugin renders. Extra fields from
// the automations plugin are dropped at the boundary so a future field there
// never breaks this plugin's output validation.
const boardAutomationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: triggerSchema,
  executionMode: z.enum(["agent", "script"]),
  providerId: z.string().nullable(),
  model: z.string().nullable(),
  nextRunAt: z.number().nullable(),
  lastRunAt: z.number().nullable(),
  lastRunStatus: z.string().nullable(),
  lastRunThreadId: z.string().nullable(),
  lastError: z.string().nullable(),
  runCount: z.number(),
  groupId: z.string().nullable(),
  /** Set when runs re-prompt one dedicated thread instead of spawning. */
  targetThreadId: z.string().nullable(),
  /** True when that dedicated thread is hidden from the sidebar. */
  background: z.boolean(),
});
export type BoardAutomation = z.infer<typeof boardAutomationSchema>;

const runSchema = z.object({
  id: z.string(),
  runMode: z.enum(["agent", "script"]),
  threadId: z.string().nullable(),
  status: z.enum(["running", "succeeded", "failed", "skipped"]),
  trigger: z.enum(["schedule", "manual"]),
  skipReason: z.string().nullable(),
  error: z.string().nullable(),
  output: z.string().nullable(),
  exitCode: z.number().nullable(),
  scheduledFor: z.number(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
});
export type Run = z.infer<typeof runSchema>;

// Derived from the run window so the page (and the CLI) can say "is this
// automation healthy?" without re-deriving it client-side.
const healthSchema = z.object({
  window: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  running: z.number().int(),
  consecutiveFailures: z.number().int(),
  lastFailureAt: z.number().nullable(),
  lastError: z.string().nullable(),
  avgDurationMs: z.number().nullable(),
});
export type Health = z.infer<typeof healthSchema>;

const runsResponseSchema = z.object({
  runs: z.array(runSchema),
  nextCursor: z.string().nullable(),
  health: healthSchema,
});
export type RunsResponse = z.infer<typeof runsResponseSchema>;

const boardSchema = z.object({
  groups: z.array(groupSchema),
  automations: z.array(boardAutomationSchema),
});
export type Board = z.infer<typeof boardSchema>;

const groupIdInput = z.object({ id: z.string().min(1) }).strict();
const automationRefInput = z
  .object({ projectId: z.string().min(1), automationId: z.string().min(1) })
  .strict();
const okOutput = z.object({ ok: z.literal(true) }).strict();
const bulkOutput = z
  .object({ ok: z.literal(true), affected: z.number().int() })
  .strict();

export const rpcContract = defineRpcContract({
  board_get: { input: z.null(), output: boardSchema },
  groups_create: {
    input: z
      .object({
        name: z.string().trim().min(1).max(GROUP_NAME_MAX),
        color: z.enum(GROUP_COLORS).optional(),
      })
      .strict(),
    output: groupSchema,
  },
  groups_update: {
    input: z
      .object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(GROUP_NAME_MAX).optional(),
        color: z.enum(GROUP_COLORS).optional(),
        collapsed: z.boolean().optional(),
      })
      .strict(),
    output: groupSchema,
  },
  groups_delete: { input: groupIdInput, output: okOutput },
  groups_reorder: {
    input: z.object({ ids: z.array(z.string().min(1)).max(500) }).strict(),
    output: okOutput,
  },
  assign: {
    input: z
      .object({
        automationId: z.string().min(1),
        groupId: z.string().min(1).nullable(),
      })
      .strict(),
    output: okOutput,
  },
  automation_pause: { input: automationRefInput, output: okOutput },
  automation_resume: { input: automationRefInput, output: okOutput },
  automation_run: { input: automationRefInput, output: okOutput },
  automation_set_background: {
    input: automationRefInput.extend({ background: z.boolean() }).strict(),
    output: z.object({ ok: z.literal(true), threadId: z.string().nullable() }).strict(),
  },
  automation_runs: {
    input: automationRefInput
      .extend({
        limit: z.number().int().positive().max(200).optional(),
        cursor: z.string().min(1).optional(),
      })
      .strict(),
    output: runsResponseSchema,
  },
  group_pause: { input: groupIdInput, output: bulkOutput },
  group_resume: { input: groupIdInput, output: bulkOutput },
  group_run: { input: groupIdInput, output: bulkOutput },
});

// ---------------------------------------------------------------------------
// Automations plugin client (loopback RPC)
// ---------------------------------------------------------------------------

const overviewSchema = z.object({
  automations: z.array(
    z.object({
      automation: z.looseObject({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        enabled: z.boolean(),
        trigger: triggerSchema,
        execution: z.looseObject({
          mode: z.enum(["agent", "script"]),
          providerId: z.string().optional(),
          model: z.string().optional(),
          permissionMode: z.string().optional(),
          reasoningLevel: z.string().optional(),
          environment: z.unknown().optional(),
          targetThreadId: z.string().optional(),
        }),
        nextRunAt: z.number().nullable().optional(),
        lastRunAt: z.number().nullable().optional(),
        lastRunStatus: z.string().nullable().optional(),
        lastRunThreadId: z.string().nullable().optional(),
        lastError: z.string().nullable().optional(),
        runCount: z.number().optional(),
      }),
      project: z.object({ id: z.string(), name: z.string() }),
    }),
  ),
});

const upstreamRunsSchema = z.object({
  runs: z.array(runSchema.loose()),
  nextCursor: z.string().nullable(),
});

type AutomationsMethod =
  | "automations_overview"
  | "automations_runs"
  | "automations_update"
  | "automations_pause"
  | "automations_resume"
  | "automations_run";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  // -------------------------------------------------------------------------
  // Storage
  // -------------------------------------------------------------------------
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS groups (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       color TEXT NOT NULL DEFAULT 'gray',
       collapsed INTEGER NOT NULL DEFAULT 0,
       sort_order INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS group_members (
       automation_id TEXT PRIMARY KEY,
       group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS group_members_group_idx ON group_members(group_id)`,
  ]);
  db.pragma("foreign_keys = ON");

  interface GroupRow {
    id: string;
    name: string;
    color: string;
    collapsed: number;
    sort_order: number;
    created_at: number;
    updated_at: number;
  }
  const toGroup = (row: GroupRow): Group => ({
    id: row.id,
    name: row.name,
    color: (GROUP_COLORS as readonly string[]).includes(row.color)
      ? (row.color as GroupColor)
      : "gray",
    collapsed: row.collapsed === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const stmts = {
    listGroups: db.prepare(
      `SELECT * FROM groups ORDER BY sort_order ASC, created_at ASC`,
    ),
    getGroup: db.prepare(`SELECT * FROM groups WHERE id = ?`),
    maxSort: db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM groups`),
    insertGroup: db.prepare(
      `INSERT INTO groups (id, name, color, collapsed, sort_order, created_at, updated_at)
       VALUES (@id, @name, @color, 0, @sortOrder, @now, @now)`,
    ),
    updateGroup: db.prepare(
      `UPDATE groups SET name = @name, color = @color, collapsed = @collapsed, updated_at = @now
       WHERE id = @id`,
    ),
    setSort: db.prepare(`UPDATE groups SET sort_order = ? WHERE id = ?`),
    deleteGroup: db.prepare(`DELETE FROM groups WHERE id = ?`),
    listMembers: db.prepare(`SELECT automation_id, group_id FROM group_members`),
    membersOf: db.prepare(
      `SELECT automation_id FROM group_members WHERE group_id = ?`,
    ),
    upsertMember: db.prepare(
      `INSERT INTO group_members (automation_id, group_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(automation_id) DO UPDATE SET group_id = excluded.group_id`,
    ),
    deleteMember: db.prepare(`DELETE FROM group_members WHERE automation_id = ?`),
  };

  function listGroups(): Group[] {
    return (stmts.listGroups.all() as GroupRow[]).map(toGroup);
  }
  function getGroup(id: string): Group | null {
    const row = stmts.getGroup.get(id) as GroupRow | undefined;
    return row ? toGroup(row) : null;
  }
  /** Resolve a group by id or (case-insensitive) exact name — for the CLI. */
  function findGroup(ref: string): Group | null {
    const byId = getGroup(ref);
    if (byId) return byId;
    const needle = ref.trim().toLowerCase();
    return listGroups().find((g) => g.name.toLowerCase() === needle) ?? null;
  }

  function publish(): void {
    bb.realtime.publish(GROUPS_CHANGED, { at: Date.now() });
  }

  function createGroup(name: string, color?: GroupColor): Group {
    const now = Date.now();
    const id = `grp_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const { m } = stmts.maxSort.get() as { m: number };
    stmts.insertGroup.run({
      id,
      name: name.trim(),
      color: color ?? "gray",
      sortOrder: m + 1,
      now,
    });
    publish();
    return getGroup(id)!;
  }

  function updateGroup(
    id: string,
    patch: { name?: string; color?: GroupColor; collapsed?: boolean },
  ): Group | null {
    const current = getGroup(id);
    if (!current) return null;
    stmts.updateGroup.run({
      id,
      name: patch.name?.trim() ?? current.name,
      color: patch.color ?? current.color,
      collapsed: (patch.collapsed ?? current.collapsed) ? 1 : 0,
      now: Date.now(),
    });
    publish();
    return getGroup(id);
  }

  function deleteGroup(id: string): boolean {
    const result = stmts.deleteGroup.run(id);
    if (result.changes > 0) publish();
    return result.changes > 0;
  }

  const reorderTx = db.transaction((ids: string[]) => {
    // Listed ids come first in the given order; unlisted groups keep their
    // relative order after them.
    const known = listGroups();
    const seen = new Set<string>();
    let order = 0;
    for (const id of ids) {
      if (seen.has(id) || !known.some((g) => g.id === id)) continue;
      seen.add(id);
      stmts.setSort.run(order++, id);
    }
    for (const g of known) {
      if (seen.has(g.id)) continue;
      stmts.setSort.run(order++, g.id);
    }
  });
  function reorderGroups(ids: string[]): void {
    reorderTx(ids);
    publish();
  }

  function assign(automationId: string, groupId: string | null): void {
    if (groupId === null) {
      stmts.deleteMember.run(automationId);
    } else {
      if (!getGroup(groupId)) throw new Error(`No group with id ${groupId}`);
      stmts.upsertMember.run(automationId, groupId, Date.now());
    }
    publish();
  }

  // -------------------------------------------------------------------------
  // Automations plugin client
  // -------------------------------------------------------------------------
  async function callAutomations(
    method: AutomationsMethod,
    input: unknown,
  ): Promise<unknown> {
    const url = `${bb.server.loopbackBaseUrl}/api/v1/plugins/automations/rpc/${method}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input ?? null),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // fall through — handled below
    }
    const parsed = z
      .union([
        z.object({ ok: z.literal(true), result: z.unknown() }),
        z.object({
          ok: z.literal(false),
          error: z.looseObject({ message: z.string().optional() }).optional(),
        }),
      ])
      .safeParse(body);
    if (!response.ok || !parsed.success || parsed.data.ok === false) {
      const message =
        parsed.success && parsed.data.ok === false
          ? (parsed.data.error?.message ?? "unknown error")
          : `HTTP ${response.status}`;
      throw new Error(`automations plugin: ${method} failed — ${message}`);
    }
    return parsed.data.result;
  }

  async function loadBoard(): Promise<Board> {
    const raw = await callAutomations("automations_overview", null);
    const overview = overviewSchema.parse(raw);
    const members = new Map(
      (stmts.listMembers.all() as { automation_id: string; group_id: string }[]).map(
        (r) => [r.automation_id, r.group_id] as const,
      ),
    );
    // Hidden-thread lookups are per target thread; a missing thread just
    // reads as "not background" rather than failing the whole board.
    const targetIds = [
      ...new Set(
        overview.automations
          .map(({ automation }) => automation.execution.targetThreadId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    const hidden = new Map<string, boolean>();
    await Promise.all(
      targetIds.map(async (threadId) => {
        try {
          const thread = await bb.sdk.threads.get({ threadId });
          hidden.set(threadId, thread.visibility === "hidden");
        } catch {
          hidden.set(threadId, false);
        }
      }),
    );
    const automations: BoardAutomation[] = overview.automations.map(
      ({ automation: a, project }) => ({
        targetThreadId: a.execution.targetThreadId ?? null,
        background: hidden.get(a.execution.targetThreadId ?? "") ?? false,
        id: a.id,
        projectId: a.projectId,
        projectName: project.name,
        name: a.name,
        enabled: a.enabled,
        trigger: a.trigger,
        executionMode: a.execution.mode,
        providerId: a.execution.providerId ?? null,
        model: a.execution.model ?? null,
        nextRunAt: a.nextRunAt ?? null,
        lastRunAt: a.lastRunAt ?? null,
        lastRunStatus: a.lastRunStatus ?? null,
        lastRunThreadId: a.lastRunThreadId ?? null,
        lastError: a.lastError ?? null,
        runCount: a.runCount ?? 0,
        groupId: members.get(a.id) ?? null,
      }),
    );
    // Prune memberships whose automation no longer exists.
    const live = new Set(automations.map((a) => a.id));
    for (const id of members.keys()) {
      if (!live.has(id)) stmts.deleteMember.run(id);
    }
    return { groups: listGroups(), automations };
  }

  async function automationAction(
    action: "pause" | "resume" | "run",
    ref: { projectId: string; automationId: string },
  ): Promise<void> {
    await callAutomations(`automations_${action}`, ref);
  }

  /**
   * Background mode = one dedicated hidden thread per automation that every
   * run re-prompts (the automations plugin's own "target thread" feature),
   * so scheduled runs stop spawning sidebar threads. Turning it off restores
   * fresh-thread runs in the automation's configured environment; the hidden
   * thread is kept for history.
   */
  async function setBackground(ref: {
    projectId: string;
    automationId: string;
    background: boolean;
  }): Promise<string | null> {
    const raw = await callAutomations("automations_overview", null);
    const entry = overviewSchema
      .parse(raw)
      .automations.find(({ automation }) => automation.id === ref.automationId);
    if (!entry) throw new Error(`No automation with id ${ref.automationId}`);
    const a = entry.automation;
    if (a.execution.mode !== "agent") {
      throw new Error("Only agent automations create threads; script automations already run without one.");
    }
    if (!ref.background) {
      if (a.execution.targetThreadId === undefined) return null;
      await callAutomations("automations_update", {
        projectId: ref.projectId,
        automationId: ref.automationId,
        agent: { target: { type: "environment", environment: a.execution.environment } },
      });
      return null;
    }
    // Reuse an existing target thread: just hide it.
    if (a.execution.targetThreadId !== undefined) {
      await bb.sdk.threads.update({ threadId: a.execution.targetThreadId, visibility: "hidden" });
      return a.execution.targetThreadId;
    }
    const spawnArgs = {
      projectId: ref.projectId,
      environment: a.execution.environment,
      title: `⚙ ${a.name}`,
      visibility: "hidden",
      providerId: a.execution.providerId,
      model: a.execution.model,
      permissionMode: a.execution.permissionMode,
      reasoningLevel: a.execution.reasoningLevel,
      prompt:
        `This hidden thread hosts background runs of the bb automation "${a.name}" (${a.id}). ` +
        `Each due run arrives as a new message starting with "[bb automation due:${a.id}]" — handle each one independently. ` +
        `Reply to this message with just "ready".`,
    } as unknown as Parameters<typeof bb.sdk.threads.spawn>[0];
    const thread = await bb.sdk.threads.spawn(spawnArgs);
    await callAutomations("automations_update", {
      projectId: ref.projectId,
      automationId: ref.automationId,
      agent: { target: { type: "target-thread", threadId: thread.id } },
    });
    return thread.id;
  }

  function summarize(runs: Run[]): Health {
    const health: Health = {
      window: runs.length,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      running: 0,
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastError: null,
      avgDurationMs: null,
    };
    let durations = 0;
    let finished = 0;
    let streakOpen = true;
    // Runs arrive newest first.
    for (const run of runs) {
      health[run.status]++;
      if (run.status === "failed") {
        if (streakOpen) health.consecutiveFailures++;
        if (health.lastFailureAt === null) {
          health.lastFailureAt = run.startedAt;
          health.lastError = run.error;
        }
      } else if (run.status !== "skipped" && run.status !== "running") {
        streakOpen = false;
      }
      if (run.finishedAt !== null && run.status !== "skipped") {
        durations += run.finishedAt - run.startedAt;
        finished++;
      }
    }
    if (finished > 0) health.avgDurationMs = Math.round(durations / finished);
    return health;
  }

  async function loadRuns(input: {
    projectId: string;
    automationId: string;
    limit?: number;
    cursor?: string;
  }): Promise<RunsResponse> {
    const raw = await callAutomations("automations_runs", {
      projectId: input.projectId,
      automationId: input.automationId,
      limit: input.limit ?? 50,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    const { runs, nextCursor } = upstreamRunsSchema.parse(raw);
    const trimmed: Run[] = runs.map((r) => runSchema.parse(r));
    return { runs: trimmed, nextCursor, health: summarize(trimmed) };
  }

  /** Apply one action to every automation in a group; returns count applied. */
  async function groupAction(
    action: "pause" | "resume" | "run",
    groupId: string,
  ): Promise<number> {
    if (!getGroup(groupId)) throw new Error(`No group with id ${groupId}`);
    const board = await loadBoard();
    const targets = board.automations.filter((a) => a.groupId === groupId);
    let affected = 0;
    const failures: string[] = [];
    for (const a of targets) {
      // Skip no-ops so a mixed group does not error on already-paused rows.
      if (action === "pause" && !a.enabled) continue;
      if (action === "resume" && a.enabled) continue;
      try {
        await automationAction(action, { projectId: a.projectId, automationId: a.id });
        affected++;
      } catch (cause) {
        failures.push(`${a.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${action} failed for ${failures.length} automation(s):\n${failures.join("\n")}`);
    }
    return affected;
  }

  // -------------------------------------------------------------------------
  // RPC
  // -------------------------------------------------------------------------
  bb.rpc.register(rpcContract, {
    board_get: () => loadBoard(),
    groups_create: ({ name, color }) => createGroup(name, color),
    groups_update: ({ id, ...patch }) => {
      const group = updateGroup(id, patch);
      if (!group) throw new Error(`No group with id ${id}`);
      return group;
    },
    groups_delete: ({ id }) => {
      if (!deleteGroup(id)) throw new Error(`No group with id ${id}`);
      return { ok: true as const };
    },
    groups_reorder: ({ ids }) => {
      reorderGroups(ids);
      return { ok: true as const };
    },
    assign: ({ automationId, groupId }) => {
      assign(automationId, groupId);
      return { ok: true as const };
    },
    automation_pause: async (ref) => {
      await automationAction("pause", ref);
      return { ok: true as const };
    },
    automation_resume: async (ref) => {
      await automationAction("resume", ref);
      return { ok: true as const };
    },
    automation_run: async (ref) => {
      await automationAction("run", ref);
      return { ok: true as const };
    },
    automation_runs: (input) => loadRuns(input),
    automation_set_background: async (input) => ({
      ok: true as const,
      threadId: await setBackground(input),
    }),
    group_pause: async ({ id }) => ({ ok: true as const, affected: await groupAction("pause", id) }),
    group_resume: async ({ id }) => ({ ok: true as const, affected: await groupAction("resume", id) }),
    group_run: async ({ id }) => ({ ok: true as const, affected: await groupAction("run", id) }),
  });

  // -------------------------------------------------------------------------
  // CLI: bb automation-group …
  // -------------------------------------------------------------------------
  const usage = [
    "Usage:",
    "  bb automation-group list [--json]                 groups with their automations",
    "  bb automation-group create <name> [--color <c>]   new group",
    "  bb automation-group rename <group> <new name>",
    "  bb automation-group color <group> <color>         " + GROUP_COLORS.join("|"),
    "  bb automation-group delete <group>                members become ungrouped",
    "  bb automation-group assign <automationId> <group>",
    "  bb automation-group unassign <automationId>",
    "  bb automation-group pause|resume|run <group>      apply to every member",
    "  bb automation-group runs <automationId> [--limit n] [--json]   run history + health",
    "  bb automation-group background <automationId> on|off   run in one hidden thread (no new sidebar threads)",
    "",
    "<group> is a group id (grp_…) or its exact name.",
  ].join("\n");

  function formatTrigger(a: BoardAutomation): string {
    return a.trigger.triggerType === "schedule"
      ? `${a.trigger.cron} (${a.trigger.timezone})`
      : `once @ ${new Date(a.trigger.runAt).toISOString()}`;
  }
  function formatAutomation(a: BoardAutomation): string {
    const state = a.enabled ? "on " : "off";
    const bg = a.background ? "  (background)" : a.targetThreadId ? "  (target thread)" : "";
    return `    [${state}] ${a.id}  ${a.name}  — ${formatTrigger(a)}  [${a.projectName}]${bg}`;
  }
  function formatBoard(board: Board): string {
    const lines: string[] = [];
    const byGroup = new Map<string | null, BoardAutomation[]>();
    for (const a of board.automations) {
      const list = byGroup.get(a.groupId) ?? [];
      list.push(a);
      byGroup.set(a.groupId, list);
    }
    for (const g of board.groups) {
      const members = byGroup.get(g.id) ?? [];
      lines.push(`${g.name}  (${g.id}, ${g.color}, ${members.length})`);
      lines.push(...members.map(formatAutomation));
    }
    const ungrouped = byGroup.get(null) ?? [];
    lines.push(`Ungrouped  (${ungrouped.length})`);
    lines.push(...ungrouped.map(formatAutomation));
    return lines.join("\n");
  }

  bb.cli.register({
    name: "automation-group",
    summary: "Group automations into named folders; pause, resume or run a whole group",
    commands: [
      { name: "list", summary: "List groups and their automations", usage: "bb automation-group list [--json]" },
      { name: "create", summary: "Create a group", usage: "bb automation-group create <name> [--color <color>]" },
      { name: "rename", summary: "Rename a group", usage: "bb automation-group rename <group> <new name>" },
      { name: "color", summary: "Set a group's color", usage: "bb automation-group color <group> <color>" },
      { name: "delete", summary: "Delete a group (members become ungrouped)", usage: "bb automation-group delete <group>" },
      { name: "assign", summary: "Put an automation into a group", usage: "bb automation-group assign <automationId> <group>" },
      { name: "unassign", summary: "Remove an automation from its group", usage: "bb automation-group unassign <automationId>" },
      { name: "pause", summary: "Pause every automation in a group", usage: "bb automation-group pause <group>" },
      { name: "resume", summary: "Resume every automation in a group", usage: "bb automation-group resume <group>" },
      { name: "run", summary: "Run every automation in a group now", usage: "bb automation-group run <group>" },
      { name: "background", summary: "Run an agent automation in one hidden dedicated thread instead of spawning a new thread per run", usage: "bb automation-group background <automationId> on|off" },
      { name: "runs", summary: "Run history and health (failure streak, error) for one automation", usage: "bb automation-group runs <automationId> [--limit <n>] [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const args = argv.filter((arg) => arg !== "--json");
      const [command, ...rest] = args;
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value, null, 2) : text,
      });
      const fail = (message: string) => ({ exitCode: 1, stderr: message });
      const needGroup = (ref: string | undefined) => {
        if (ref === undefined) return null;
        return findGroup(ref);
      };
      const noGroup = (ref: string) =>
        fail(`No group "${ref}". Run "bb automation-group list" to see groups.`);

      try {
        switch (command) {
          case undefined:
          case "help":
          case "--help":
            return { exitCode: 0, stdout: usage };
          case "list": {
            const board = await loadBoard();
            return reply(board, formatBoard(board));
          }
          case "create": {
            let color: GroupColor | undefined;
            const words: string[] = [];
            for (let i = 0; i < rest.length; i++) {
              if (rest[i] === "--color") {
                const c = rest[++i];
                if (!(GROUP_COLORS as readonly string[]).includes(c ?? "")) {
                  return fail(`--color must be one of: ${GROUP_COLORS.join(", ")}`);
                }
                color = c as GroupColor;
              } else words.push(rest[i]!);
            }
            const name = words.join(" ").trim();
            if (name === "") break;
            if (name.length > GROUP_NAME_MAX) return fail(`Name too long (max ${GROUP_NAME_MAX}).`);
            const group = createGroup(name, color);
            return reply(group, `Created ${group.name} (${group.id})`);
          }
          case "rename": {
            const [ref, ...nameWords] = rest;
            const name = nameWords.join(" ").trim();
            if (ref === undefined || name === "") break;
            const group = needGroup(ref);
            if (!group) return noGroup(ref);
            const updated = updateGroup(group.id, { name })!;
            return reply(updated, `Renamed ${group.id} → ${updated.name}`);
          }
          case "color": {
            const [ref, color] = rest;
            if (ref === undefined || color === undefined) break;
            if (!(GROUP_COLORS as readonly string[]).includes(color)) {
              return fail(`Color must be one of: ${GROUP_COLORS.join(", ")}`);
            }
            const group = needGroup(ref);
            if (!group) return noGroup(ref);
            const updated = updateGroup(group.id, { color: color as GroupColor })!;
            return reply(updated, `${updated.name} is now ${updated.color}`);
          }
          case "delete": {
            const [ref] = rest;
            if (ref === undefined) break;
            const group = needGroup(ref);
            if (!group) return noGroup(ref);
            deleteGroup(group.id);
            return reply({ deleted: group.id }, `Deleted ${group.name} (${group.id})`);
          }
          case "assign": {
            const [automationId, ...refWords] = rest;
            const ref = refWords.join(" ").trim();
            if (automationId === undefined || ref === "") break;
            const group = needGroup(ref);
            if (!group) return noGroup(ref);
            const board = await loadBoard();
            if (!board.automations.some((a) => a.id === automationId)) {
              return fail(`No automation with id ${automationId}.`);
            }
            assign(automationId, group.id);
            return reply({ automationId, groupId: group.id }, `${automationId} → ${group.name}`);
          }
          case "unassign": {
            const [automationId] = rest;
            if (automationId === undefined) break;
            assign(automationId, null);
            return reply({ automationId, groupId: null }, `${automationId} is now ungrouped`);
          }
          case "background": {
            const [automationId, mode] = rest;
            if (automationId === undefined || (mode !== "on" && mode !== "off")) break;
            const board = await loadBoard();
            const a = board.automations.find((x) => x.id === automationId);
            if (!a) return fail(`No automation with id ${automationId}.`);
            const threadId = await setBackground({
              projectId: a.projectId,
              automationId,
              background: mode === "on",
            });
            return reply(
              { automationId, background: mode === "on", threadId },
              mode === "on"
                ? `${a.name}: background on — runs go to hidden thread ${threadId}`
                : `${a.name}: background off — each run spawns a new thread`,
            );
          }
          case "runs": {
            let limit = 20;
            const words: string[] = [];
            for (let i = 0; i < rest.length; i++) {
              if (rest[i] === "--limit") {
                limit = Number(rest[++i]);
                if (!Number.isInteger(limit) || limit < 1 || limit > 200) return fail("--limit must be 1..200");
              } else words.push(rest[i]!);
            }
            const [automationId] = words;
            if (automationId === undefined) break;
            const board = await loadBoard();
            const a = board.automations.find((x) => x.id === automationId);
            if (!a) return fail(`No automation with id ${automationId}.`);
            const result = await loadRuns({ projectId: a.projectId, automationId, limit });
            const h = result.health;
            const lines = [
              `${a.name}  (${a.id}, ${a.enabled ? "on" : "off"}, ${formatTrigger(a)})`,
              `health: last ${h.window} runs — ${h.succeeded} ok, ${h.failed} failed, ${h.skipped} skipped` +
                (h.consecutiveFailures > 0 ? `, ${h.consecutiveFailures} failure(s) in a row` : "") +
                (h.avgDurationMs !== null ? `, avg ${Math.round(h.avgDurationMs / 1000)}s` : ""),
              ...(h.lastError ? [`last error: ${h.lastError.slice(0, 500)}`] : []),
              "",
              ...result.runs.map((r) => {
                const dur = r.finishedAt !== null ? `${Math.round((r.finishedAt - r.startedAt) / 1000)}s` : "…";
                const tail = r.status === "failed" ? `  ${(r.error ?? "").slice(0, 160)}` : r.status === "skipped" ? `  ${r.skipReason ?? ""}` : "";
                return `  ${new Date(r.startedAt).toISOString()}  ${r.status.padEnd(9)} ${r.trigger.padEnd(8)} ${dur.padStart(5)}  ${r.threadId ?? r.id}${tail}`;
              }),
            ];
            return reply({ automation: a, ...result }, lines.join("\n"));
          }
          case "pause":
          case "resume":
          case "run": {
            const ref = rest.join(" ").trim();
            if (ref === "") break;
            const group = needGroup(ref);
            if (!group) return noGroup(ref);
            const affected = await groupAction(command, group.id);
            return reply(
              { groupId: group.id, action: command, affected },
              `${command}: ${affected} automation(s) in ${group.name}`,
            );
          }
        }
      } catch (cause) {
        return fail(cause instanceof Error ? cause.message : String(cause));
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
