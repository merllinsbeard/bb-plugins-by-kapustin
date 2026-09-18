// bb-plugin-automation-groups — frontend entry.
//
// One page: every automation across projects, grouped into user-defined
// folders. Rows drag between groups (native HTML5 DnD) or move via the row's
// group picker. Group headers pause / resume / run all members at once.
// Automation data is proxied by server.ts from the builtin automations
// plugin, so the builtin Automations page remains the place to create and
// edit an automation — rows link there.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent, ReactNode } from "react";
import {
  ThreadChat,
  definePluginApp,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { Board, BoardAutomation, Group, Run, RunsResponse, rpcContract } from "./server";
import { GROUP_COLORS, GROUPS_CHANGED, type GroupColor } from "./shared";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLOR_DOT: Record<GroupColor, string> = {
  gray: "bg-muted-foreground/60",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-emerald-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

const UNGROUPED = "__ungrouped__";
const DND_TYPE = "application/x-bb-automation-id";

function relative(ts: number | null, now: number): string {
  if (ts === null) return "—";
  const delta = ts - now;
  const abs = Math.abs(delta);
  const unit =
    abs < 60_000
      ? [Math.round(abs / 1000), "s"]
      : abs < 3_600_000
        ? [Math.round(abs / 60_000), "m"]
        : abs < 86_400_000
          ? [Math.round(abs / 3_600_000), "h"]
          : [Math.round(abs / 86_400_000), "d"];
  return delta >= 0 ? `in ${unit[0]}${unit[1]}` : `${unit[0]}${unit[1]} ago`;
}

function triggerLabel(a: BoardAutomation): string {
  if (a.trigger.triggerType === "schedule") return a.trigger.cron;
  return `once · ${new Date(a.trigger.runAt).toLocaleString()}`;
}

function statusTone(status: string | null): string {
  switch (status) {
    case "succeeded":
      return "text-emerald-600 dark:text-emerald-400";
    case "failed":
      return "text-destructive";
    case "running":
      return "text-primary";
    default:
      return "text-muted-foreground";
  }
}

const PANEL_PATH = "groups";
const BROWSE_TEMPLATES_HREF = "/plugins/automations/automations/browse";

/**
 * The builtin Automations page creates automations by dropping the user into
 * a new thread with a seed prompt; mirror that so creation feels native, and
 * when a group is targeted, tell the agent to file the result there.
 */
function newAutomationPrompt(group: Group | null): string {
  const base = "Create a new bb automation to ";
  if (!group) return base;
  return `${base}\n\n(When done, add it to the automation group "${group.name}" with \`bb automation-group assign <automationId> "${group.name}"\`.)`;
}

function matches(a: BoardAutomation, query: string): boolean {
  if (!query) return true;
  const hay = [a.name, a.projectName, triggerLabel(a), a.providerId ?? "", a.model ?? ""]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function useBoard() {
  const rpc = useRpc<typeof rpcContract>();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const refetch = useCallback(() => {
    if (inflight.current) return;
    inflight.current = true;
    rpc
      .call("board_get")
      .then((next) => {
        setBoard(next);
        setError(null);
      })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => {
        inflight.current = false;
      });
  }, [rpc]);
  useEffect(() => {
    refetch();
    // The automations plugin publishes on its own channel which this plugin
    // cannot subscribe to, so poll for run-state changes at a gentle rate.
    const timer = setInterval(refetch, 30_000);
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetch]);
  useRealtime(GROUPS_CHANGED, refetch);
  return { rpc, board, error, refetch, setError };
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

function IconButton({
  label,
  icon,
  onClick,
  disabled,
  className,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-7 text-muted-foreground hover:text-foreground", className)}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} className="size-4" />
    </Button>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: GroupColor;
  onChange: (color: GroupColor) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Group color">
      {GROUP_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          title={color}
          onClick={() => onChange(color)}
          className={cn(
            "size-4 rounded-full ring-offset-background transition-transform hover:scale-110",
            COLOR_DOT[color],
            value === color && "ring-2 ring-foreground ring-offset-2",
          )}
        />
      ))}
    </div>
  );
}

interface RowProps {
  automation: BoardAutomation;
  groups: Group[];
  providerName: string | null;
  now: number;
  busy: boolean;
  onMove: (groupId: string | null) => void;
  onPause: () => void;
  onResume: () => void;
  onRun: () => void;
  onOpen: () => void;
}

function AutomationRow({
  automation: a,
  groups,
  providerName,
  now,
  busy,
  onMove,
  onPause,
  onResume,
  onRun,
  onOpen,
}: RowProps) {
  const onDragStart = (event: DragEvent<HTMLLIElement>) => {
    event.dataTransfer.setData(DND_TYPE, a.id);
    event.dataTransfer.effectAllowed = "move";
  };
  return (
    <li
      draggable
      onDragStart={onDragStart}
      className={cn(
        "flex items-center gap-3 py-2 text-sm",
        busy && "opacity-60",
        !a.enabled && "text-muted-foreground",
      )}
    >
      <Icon
        name="DragDropVertical"
        className="size-4 shrink-0 cursor-grab text-muted-foreground/50"
        aria-hidden
      />
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          a.enabled ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
        title={a.enabled ? "Enabled" : "Paused"}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="truncate text-left font-medium text-foreground hover:underline"
            title="Runs and health"
          >
            {a.name}
          </button>
          {a.background ? (
            <span
              className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              title="Runs in one hidden thread"
            >
              bg
            </span>
          ) : null}
          {a.lastRunStatus === "failed" ? (
            <span
              className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive"
              title={a.lastError ?? undefined}
            >
              failed
            </span>
          ) : null}
          {a.executionMode === "agent" && a.providerId ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
              title={a.model ?? undefined}
            >
              <ProviderIcon providerKind="agent" provider={{ id: a.providerId }} className="size-3.5" />
              <span className="hidden sm:inline">{providerName ?? a.providerId}</span>
            </span>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground">script</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{triggerLabel(a)}</span>
          <span>{a.projectName}</span>
          <span>next {relative(a.nextRunAt, now)}</span>
          <span className={statusTone(a.lastRunStatus)} title={a.lastError ?? undefined}>
            {a.lastRunStatus ? `${a.lastRunStatus} ${relative(a.lastRunAt, now)}` : "never ran"}
          </span>
        </div>
      </div>
      <select
        aria-label={`Group for ${a.name}`}
        className="h-7 max-w-36 rounded-md border border-input bg-transparent px-2 text-xs text-foreground"
        value={a.groupId ?? UNGROUPED}
        disabled={busy}
        onChange={(event) =>
          onMove(event.target.value === UNGROUPED ? null : event.target.value)
        }
      >
        <option value={UNGROUPED}>Ungrouped</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      {a.enabled ? (
        <IconButton label="Pause" icon="Pause" onClick={onPause} disabled={busy} />
      ) : (
        <IconButton label="Resume" icon="Play" onClick={onResume} disabled={busy} />
      )}
      <IconButton label="Run now" icon="ArrowRight" onClick={onRun} disabled={busy} />
    </li>
  );
}

interface SectionProps {
  group: Group | null;
  automations: BoardAutomation[];
  children: ReactNode;
  busy: boolean;
  onDrop: (automationId: string) => void;
  onToggleCollapsed?: () => void;
  onRename?: (name: string) => void;
  onColor?: (color: GroupColor) => void;
  onDelete?: () => void;
  onNew?: () => void;
  onPauseAll?: () => void;
  onResumeAll?: () => void;
  onRunAll?: () => void;
}

function GroupSection({
  group,
  automations,
  children,
  busy,
  onDrop,
  onToggleCollapsed,
  onRename,
  onColor,
  onDelete,
  onNew,
  onPauseAll,
  onResumeAll,
  onRunAll,
}: SectionProps) {
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group?.name ?? "");
  const collapsed = group?.collapsed ?? false;
  const enabledCount = automations.filter((a) => a.enabled).length;

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes(DND_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!over) setOver(true);
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    const id = event.dataTransfer.getData(DND_TYPE);
    setOver(false);
    if (!id) return;
    event.preventDefault();
    onDrop(id);
  };
  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    setEditing(false);
    if (next && next !== group?.name) onRename?.(next);
  };

  return (
    <section
      onDragOver={handleDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      className={cn(
        "rounded-lg border border-border bg-card transition-colors",
        over && "border-primary bg-primary/5",
      )}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        {group ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand group" : "Collapse group"}
            className="text-muted-foreground hover:text-foreground"
          >
            <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} className="size-4" />
          </button>
        ) : (
          <Icon name="Folder02" className="size-4 text-muted-foreground" />
        )}
        {group ? (
          <span className={cn("size-2.5 shrink-0 rounded-full", COLOR_DOT[group.color])} />
        ) : null}
        {editing && group ? (
          <form onSubmit={submitRename} className="flex flex-1 items-center gap-2">
            <Input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={submitRename}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDraft(group.name);
                  setEditing(false);
                }
              }}
              className="h-7 max-w-xs text-sm"
              aria-label="Group name"
            />
          </form>
        ) : (
          <h2
            className="min-w-0 flex-1 truncate text-sm font-semibold"
            onDoubleClick={() => {
              if (!group) return;
              setDraft(group.name);
              setEditing(true);
            }}
          >
            {group ? group.name : "Ungrouped"}
            <span className="ml-2 font-normal text-muted-foreground">
              {enabledCount}/{automations.length} on
            </span>
          </h2>
        )}
        {group ? (
          <>
            <ColorPicker value={group.color} onChange={(c) => onColor?.(c)} />
            <IconButton label="New automation in this group" icon="Plus" onClick={() => onNew?.()} />
            <IconButton
              label="Rename group"
              icon="Edit"
              onClick={() => {
                setDraft(group.name);
                setEditing(true);
              }}
            />
            <IconButton
              label="Pause all"
              icon="Pause"
              onClick={() => onPauseAll?.()}
              disabled={busy || enabledCount === 0}
            />
            <IconButton
              label="Resume all"
              icon="Play"
              onClick={() => onResumeAll?.()}
              disabled={busy || enabledCount === automations.length}
            />
            <IconButton
              label="Run all now"
              icon="ArrowRight"
              onClick={() => onRunAll?.()}
              disabled={busy || automations.length === 0}
            />
            <IconButton
              label="Delete group"
              icon="Trash2"
              className="hover:text-destructive"
              onClick={() => onDelete?.()}
              disabled={busy}
            />
          </>
        ) : null}
      </header>
      {collapsed ? null : (
        <div className="border-t border-border px-3">
          {automations.length === 0 ? (
            <p className="py-3 text-xs text-muted-foreground">
              Drop automations here.
            </p>
          ) : (
            <ul className="divide-y divide-border">{children}</ul>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function GroupsPage() {
  const { rpc, board, error, refetch, setError } = useBoard();
  const { providers } = useProviders();
  const navigate = useBbNavigate();
  const [newName, setNewName] = useState("");
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const providerNames = useMemo(
    () => new Map(providers.map((p) => [p.id, p.displayName] as const)),
    [providers],
  );

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of board?.automations ?? []) map.set(a.projectId, a.projectName);
    return [...map.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [board]);

  const filtering = query.trim() !== "" || projectId !== "";
  const byGroup = useMemo(() => {
    const map = new Map<string | null, BoardAutomation[]>();
    const q = query.trim();
    for (const a of board?.automations ?? []) {
      if (projectId && a.projectId !== projectId) continue;
      if (!matches(a, q)) continue;
      const list = map.get(a.groupId) ?? [];
      list.push(a);
      map.set(a.groupId, list);
    }
    for (const list of map.values()) list.sort((x, y) => x.name.localeCompare(y.name));
    return map;
  }, [board, query, projectId]);

  const openNewAutomation = (group: Group | null) =>
    navigate.toCompose({ initialPrompt: newAutomationPrompt(group), focusPrompt: true });

  /** Run an RPC with optimistic busy state on the given ids, then refetch. */
  const act = useCallback(
    async (ids: string[], work: () => Promise<unknown>, success?: string) => {
      setBusyIds((prev) => new Set([...prev, ...ids]));
      try {
        await work();
        if (success) toast.success(success);
        refetch();
      } catch (cause) {
        const message = errorMessage(cause);
        setError(message);
        toast.error(message);
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      }
    },
    [refetch, setError],
  );

  const createGroup = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    await act([], () => rpc.call("groups_create", { name }), `Created "${name}"`);
  };

  const move = (automationId: string, groupId: string | null) =>
    act([automationId], () => rpc.call("assign", { automationId, groupId }));

  const groupIds = (groupId: string) =>
    (byGroup.get(groupId) ?? []).map((a) => a.id).concat(groupId);

  const renderRows = (list: BoardAutomation[]) =>
    list.map((a) => {
      const ref = { projectId: a.projectId, automationId: a.id };
      return (
        <AutomationRow
          key={a.id}
          automation={a}
          groups={board?.groups ?? []}
          providerName={a.providerId ? (providerNames.get(a.providerId) ?? null) : null}
          now={now}
          busy={busyIds.has(a.id)}
          onMove={(groupId) => void move(a.id, groupId)}
          onPause={() => void act([a.id], () => rpc.call("automation_pause", ref))}
          onResume={() => void act([a.id], () => rpc.call("automation_resume", ref))}
          onRun={() =>
            void act([a.id], () => rpc.call("automation_run", ref), `Started "${a.name}"`)
          }
          onOpen={() => navigate.toPluginPanel(PANEL_PATH, { subPath: `${a.projectId}/${a.id}` })}
        />
      );
    });

  const ungrouped = byGroup.get(null) ?? [];

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-4xl px-4 pb-6 pt-3 md:px-5 md:pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            Every automation across projects, grouped. Drag rows between
            groups; group actions pause, resume or run every member. Agents use{" "}
            <code>bb automation-group</code>.
          </p>
          <a
            href={BROWSE_TEMPLATES_HREF}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Browse templates
          </a>
          <Button onClick={() => openNewAutomation(null)}>
            <Icon name="Plus" className="size-4" />
            New automation
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search automations"
            aria-label="Search automations"
            className="min-w-48 flex-1"
          />
          {projects.length > 1 ? (
            <select
              aria-label="Project"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm text-foreground"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">All projects</option>
              {projects.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          <form onSubmit={createGroup} className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="New group name"
              aria-label="New group name"
              maxLength={80}
              className="w-44"
            />
            <Button type="submit" variant="outline" disabled={newName.trim() === ""}>
              <Icon name="FolderPlus" className="size-4" />
              Add group
            </Button>
          </form>
          <IconButton label="Refresh" icon="RotateCcw" onClick={refetch} />
        </div>
        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-col gap-3">
          {board === null ? (
            <EmptyState>Loading automations…</EmptyState>
          ) : board.automations.length === 0 && board.groups.length === 0 ? (
            <EmptyState>
              No automations yet.{" "}
              <button
                type="button"
                className="underline underline-offset-4 hover:text-foreground"
                onClick={() => openNewAutomation(null)}
              >
                Create one
              </button>
              , then group it here.
            </EmptyState>
          ) : (
            <>
              {board.groups.map((group) => {
                const list = byGroup.get(group.id) ?? [];
                const busy = busyIds.has(group.id);
                if (filtering && list.length === 0) return null;
                return (
                  <GroupSection
                    key={group.id}
                    group={group}
                    automations={list}
                    busy={busy}
                    onDrop={(id) => void move(id, group.id)}
                    onToggleCollapsed={() =>
                      void act([], () =>
                        rpc.call("groups_update", { id: group.id, collapsed: !group.collapsed }),
                      )
                    }
                    onRename={(name) =>
                      void act([], () => rpc.call("groups_update", { id: group.id, name }))
                    }
                    onColor={(color) =>
                      void act([], () => rpc.call("groups_update", { id: group.id, color }))
                    }
                    onNew={() => openNewAutomation(group)}
                    onDelete={() => {
                      if (
                        !window.confirm(
                          `Delete group "${group.name}"? Its ${list.length} automation(s) become ungrouped.`,
                        )
                      )
                        return;
                      void act([group.id], () => rpc.call("groups_delete", { id: group.id }), `Deleted "${group.name}"`);
                    }}
                    onPauseAll={() =>
                      void act(
                        groupIds(group.id),
                        () => rpc.call("group_pause", { id: group.id }),
                        `Paused "${group.name}"`,
                      )
                    }
                    onResumeAll={() =>
                      void act(
                        groupIds(group.id),
                        () => rpc.call("group_resume", { id: group.id }),
                        `Resumed "${group.name}"`,
                      )
                    }
                    onRunAll={() => {
                      if (!window.confirm(`Run all ${list.length} automation(s) in "${group.name}" now?`)) return;
                      void act(
                        groupIds(group.id),
                        () => rpc.call("group_run", { id: group.id }),
                        `Started "${group.name}"`,
                      );
                    }}
                  >
                    {renderRows(list)}
                  </GroupSection>
                );
              })}
              {filtering && ungrouped.length === 0 ? null : (
              <GroupSection
                group={null}
                automations={ungrouped}
                busy={false}
                onDrop={(id) => void move(id, null)}
              >
                {renderRows(ungrouped)}
              </GroupSection>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail: runs, health, transcript
// ---------------------------------------------------------------------------

function duration(run: Run, now: number): string {
  const end = run.finishedAt ?? now;
  const ms = Math.max(0, end - run.startedAt);
  return ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 60_000)}m`;
}

function StatusDot({ status }: { status: Run["status"] }) {
  const cls =
    status === "succeeded"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-destructive"
        : status === "running"
          ? "bg-primary animate-pulse"
          : "bg-muted-foreground/40";
  return <span className={cn("size-2 shrink-0 rounded-full", cls)} aria-hidden />;
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

function RunRow({
  run,
  now,
  expanded,
  onToggle,
  onOpenThread,
}: {
  run: Run;
  now: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenThread: (threadId: string) => void;
}) {
  const detail = run.status === "failed" ? run.error : run.status === "skipped" ? run.skipReason : null;
  const canExpand = run.threadId !== null || run.output !== null || detail !== null;
  return (
    <li className="py-1">
      <button
        type="button"
        onClick={onToggle}
        disabled={!canExpand}
        className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover disabled:cursor-default disabled:hover:bg-transparent"
        aria-expanded={expanded}
      >
        <Icon
          name={expanded ? "ChevronDown" : "ChevronRight"}
          className={cn("size-4 shrink-0 text-muted-foreground", !canExpand && "invisible")}
        />
        <StatusDot status={run.status} />
        <span className={cn("w-20 shrink-0 font-medium", statusTone(run.status))}>{run.status}</span>
        <span className="w-40 shrink-0 tabular-nums text-muted-foreground">
          {new Date(run.startedAt).toLocaleString()}
        </span>
        <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{duration(run, now)}</span>
        <span className="w-16 shrink-0 text-xs text-muted-foreground">{run.trigger}</span>
        <span className="w-14 shrink-0 text-xs text-muted-foreground">{run.runMode}</span>
        {run.exitCode !== null ? (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">exit {run.exitCode}</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-xs text-destructive">{detail ?? ""}</span>
      </button>
      {expanded ? (
        <div className="ml-9 mr-2 mt-1 mb-2 flex flex-col gap-2">
          {detail ? (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {detail}
            </pre>
          ) : null}
          {run.output !== null ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
              {run.output}
            </pre>
          ) : null}
          {run.threadId !== null ? (
            <div className="rounded-md border border-border">
              <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
                <span>
                  Thread <span className="font-mono">{run.threadId}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => onOpenThread(run.threadId!)}>
                  Open thread
                  <Icon name="ArrowUpRight" className="size-3.5" />
                </Button>
              </div>
              <div className="max-h-[32rem] overflow-auto">
                <ThreadChat threadId={run.threadId} variant="timeline" layout="document" />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function DetailPage({ projectId, automationId }: { projectId: string; automationId: string }) {
  const { rpc, board, error, refetch, setError } = useBoard();
  const navigate = useBbNavigate();
  const [runs, setRuns] = useState<RunsResponse | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const ref = useMemo(() => ({ projectId, automationId }), [projectId, automationId]);
  const loadRuns = useCallback(
    (cursor?: string) => {
      rpc
        .call("automation_runs", { ...ref, limit: 50, ...(cursor ? { cursor } : {}) })
        .then((next) => {
          setRuns((prev) =>
            cursor && prev ? { ...next, runs: [...prev.runs, ...next.runs] } : next,
          );
          setRunsError(null);
        })
        .catch((cause) => setRunsError(errorMessage(cause)));
    },
    [rpc, ref],
  );
  useEffect(() => {
    loadRuns();
    const timer = setInterval(() => loadRuns(), 20_000);
    return () => clearInterval(timer);
  }, [loadRuns]);

  const a = board?.automations.find((x) => x.id === automationId && x.projectId === projectId) ?? null;
  const health = runs?.health ?? null;
  const editHref = `/plugins/automations/automations/${projectId}/${automationId}`;

  const act = async (work: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await work();
      if (success) toast.success(success);
      refetch();
      loadRuns();
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-4xl px-4 pb-6 pt-3 md:px-5 md:pt-4">
        <button
          type="button"
          onClick={() => navigate.toPluginPanel(PANEL_PATH, { subPath: "" })}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="ChevronLeft" className="size-4" />
          All automations
        </button>

        {board === null ? (
          <div className="mt-4">
            <EmptyState>Loading…</EmptyState>
          </div>
        ) : a === null ? (
          <div className="mt-4">
            <EmptyState>Automation {automationId} not found.</EmptyState>
          </div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="flex items-center gap-2 text-lg font-semibold">
                  <span className={cn("size-2.5 rounded-full", a.enabled ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                  <span className="truncate">{a.name}</span>
                </h1>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="font-mono">{triggerLabel(a)}</span>
                  {a.trigger.triggerType === "schedule" ? <span>{a.trigger.timezone}</span> : null}
                  <span>{a.projectName}</span>
                  <span>{a.executionMode === "agent" ? `${a.providerId ?? ""} · ${a.model ?? ""}` : "script"}</span>
                  <span>next {relative(a.nextRunAt, now)}</span>
                  <span className="font-mono">{a.id}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {a.enabled ? (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => rpc.call("automation_pause", ref), "Paused")}>
                    <Icon name="Pause" className="size-4" /> Pause
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => rpc.call("automation_resume", ref), "Resumed")}>
                    <Icon name="Play" className="size-4" /> Resume
                  </Button>
                )}
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => rpc.call("automation_run", ref), "Started")}>
                  <Icon name="ArrowRight" className="size-4" /> Run now
                </Button>
                <a href={editHref} className="inline-flex h-8 items-center gap-1 rounded-md px-3 text-xs font-medium text-muted-foreground hover:text-foreground">
                  Edit <Icon name="ArrowUpRight" className="size-3.5" />
                </a>
              </div>
            </div>

            {a.executionMode === "agent" ? (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={a.background}
                  disabled={busy}
                  onChange={(event) =>
                    void act(
                      () => rpc.call("automation_set_background", { ...ref, background: event.target.checked }),
                      event.target.checked ? "Background mode on" : "Background mode off",
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="font-medium">Run in background</span>
                  <span className="block text-xs text-muted-foreground">
                    Every run re-prompts one dedicated hidden thread instead of creating a new sidebar thread.
                    {a.targetThreadId ? (
                      <>
                        {" "}Thread{" "}
                        <button type="button" className="font-mono underline-offset-2 hover:underline" onClick={() => navigate.toThread(a.targetThreadId!)}>
                          {a.targetThreadId}
                        </button>
                        {a.background ? "" : " (visible — turn on to hide it)"}.
                      </>
                    ) : null}
                  </span>
                </span>
              </label>
            ) : null}

            {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}

            {health && health.consecutiveFailures > 0 ? (
              <div role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                <div className="font-medium text-destructive">
                  {health.consecutiveFailures} failure{health.consecutiveFailures > 1 ? "s" : ""} in a row
                  {health.lastFailureAt ? ` · last ${relative(health.lastFailureAt, now)}` : ""}
                </div>
                {health.lastError ? (
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-destructive/90">{health.lastError}</pre>
                ) : null}
              </div>
            ) : null}

            {health ? (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label={`Success (last ${health.window})`}
                  value={health.window - health.skipped - health.running > 0 ? `${Math.round((health.succeeded / (health.window - health.skipped - health.running)) * 100)}%` : "—"}
                  tone={health.failed > 0 ? (health.consecutiveFailures > 0 ? "text-destructive" : "text-amber-600 dark:text-amber-400") : "text-emerald-600 dark:text-emerald-400"}
                />
                <Stat label="Failed" value={health.failed} tone={health.failed > 0 ? "text-destructive" : undefined} />
                <Stat label="Skipped" value={health.skipped} />
                <Stat label="Avg duration" value={health.avgDurationMs !== null ? (health.avgDurationMs < 60_000 ? `${(health.avgDurationMs / 1000).toFixed(1)}s` : `${Math.round(health.avgDurationMs / 60_000)}m`) : "—"} />
              </div>
            ) : null}

            <h2 className="mt-6 text-sm font-semibold">Runs</h2>
            {runsError ? <p role="alert" className="mt-2 text-sm text-destructive">{runsError}</p> : null}
            <div className="mt-2 rounded-lg border border-border bg-card">
              {runs === null ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">Loading runs…</p>
              ) : runs.runs.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No runs yet.</p>
              ) : (
                <ul className="divide-y divide-border px-1">
                  {runs.runs.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      now={now}
                      expanded={expanded.has(run.id)}
                      onToggle={() => toggle(run.id)}
                      onOpenThread={(threadId) => navigate.toThread(threadId)}
                    />
                  ))}
                </ul>
              )}
              {runs?.nextCursor ? (
                <div className="border-t border-border p-2">
                  <Button variant="ghost" size="sm" onClick={() => loadRuns(runs.nextCursor!)}>
                    Load more
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RootPage({ subPath }: { subPath: string }) {
  const parts = subPath.split("/").filter(Boolean);
  if (parts.length >= 2) return <DetailPage projectId={parts[0]!} automationId={parts[1]!} />;
  return <GroupsPage />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "groups",
    title: "Automation groups",
    icon: "Layers",
    // Routed at /plugins/automation-groups/groups
    path: PANEL_PATH,
    component: RootPage,
  });
});
