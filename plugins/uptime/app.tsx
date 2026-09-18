// bb-plugin-uptime — frontend entry.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  definePluginApp,
  UrlLink,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, Site, Check } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ListResult = { sites: Site[]; intervalSeconds: number; lastSweepAt: number | null };

function useSites() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<ListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const refetch = useCallback(() => {
    rpc.call("sites_list").then((result) => {
      setData(result);
      setError(null);
    }, report);
  }, [rpc, report]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("sites-changed", refetch);
  return { rpc, data, error, report, refetch };
}

function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

type State = "up" | "down" | "unknown";
function stateOf(site: Site): State {
  const last = site.checks.at(-1);
  return !last ? "unknown" : last.ok ? "up" : "down";
}

const STATE_STYLE: Record<State, { dot: string; label: string; text: string }> = {
  up: { dot: "bg-emerald-500", label: "Up", text: "text-emerald-600 dark:text-emerald-400" },
  down: { dot: "bg-destructive animate-pulse", label: "Down", text: "text-destructive" },
  unknown: { dot: "bg-muted-foreground/40", label: "Pending", text: "text-muted-foreground" },
};

function uptimePct(checks: Check[]): number | null {
  if (checks.length === 0) return null;
  return Math.round((100 * checks.filter((c) => c.ok).length) / checks.length);
}
function avgMs(checks: Check[]): number | null {
  const ok = checks.filter((c) => c.ok);
  if (ok.length === 0) return null;
  return Math.round(ok.reduce((n, c) => n + c.ms, 0) / ok.length);
}

/** Last N checks as thin bars: green ok, red fail, height ~ latency. */
function History({ checks }: { checks: Check[] }) {
  const slots = 60;
  const padded: Array<Check | null> = [
    ...Array<null>(Math.max(0, slots - checks.length)).fill(null),
    ...checks.slice(-slots),
  ];
  const max = Math.max(1, ...checks.map((c) => c.ms));
  return (
    <div
      className="flex h-8 items-end gap-px"
      role="img"
      aria-label={`Last ${checks.length} checks`}
    >
      {padded.map((c, i) => (
        <span
          key={i}
          title={
            c
              ? `${new Date(c.at).toLocaleTimeString()} — ${c.ok ? "ok" : "fail"} ${c.status ?? c.error ?? ""} ${c.ms}ms`
              : undefined
          }
          className={cn(
            "flex-1 rounded-sm",
            c === null
              ? "bg-muted/40"
              : c.ok
                ? "bg-emerald-500/70"
                : "bg-destructive",
          )}
          style={{ height: c ? `${Math.max(15, (100 * c.ms) / max)}%` : "15%" }}
        />
      ))}
    </div>
  );
}

function SiteCard({
  site,
  now,
  busy,
  onCheck,
  onRemove,
}: {
  site: Site;
  now: number;
  busy: boolean;
  onCheck: () => void;
  onRemove: () => void;
}) {
  const state = stateOf(site);
  const style = STATE_STYLE[state];
  const last = site.checks.at(-1);
  const pct = uptimePct(site.checks);
  const avg = avgMs(site.checks);
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", style.dot)}
          role="img"
          aria-label={style.label}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{site.name}</span>
            <span className={cn("text-xs font-medium", style.text)}>{style.label}</span>
          </div>
          <UrlLink
            href={site.url}
            className="block truncate text-xs text-muted-foreground hover:underline"
          >
            {site.url}
          </UrlLink>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label={`Check ${site.name} now`}
            disabled={busy}
            onClick={onCheck}
          >
            <Icon name="RotateCcw" className={cn("size-4", busy && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${site.name}`}
            onClick={onRemove}
          >
            <Icon name="Trash2" className="size-4" />
          </Button>
        </div>
      </div>
      <div className="mt-3">
        <History checks={site.checks} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span>
          Last: {last ? `${last.status ?? last.error} · ${last.ms}ms · ${relativeTime(last.at, now)}` : "—"}
        </span>
        <span>Uptime: {pct === null ? "—" : `${pct}%`}</span>
        <span>Avg: {avg === null ? "—" : `${avg}ms`}</span>
        <span>Checks: {site.checks.length}</span>
      </div>
      {last && !last.ok && last.error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {last.error}
        </p>
      ) : null}
    </li>
  );
}

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

function MonitorPage() {
  const { rpc, data, error, report, refetch } = useSites();
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState<string | "all" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = url.trim();
    if (next === "" || pending) return;
    setPending(true);
    try {
      await rpc.call("sites_add", { url: next });
      setUrl("");
      refetch();
    } catch (cause) {
      report(cause);
    } finally {
      setPending(false);
    }
  };
  const check = async (id?: string) => {
    setChecking(id ?? "all");
    try {
      await rpc.call("sites_check", id ? { id } : {});
      refetch();
    } catch (cause) {
      report(cause);
    } finally {
      setChecking(null);
    }
  };

  const sites = data?.sites ?? [];
  const up = sites.filter((s) => stateOf(s) === "up").length;
  const down = sites.filter((s) => stateOf(s) === "down").length;

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl space-y-4 px-4 pb-6 pt-3 md:px-5 md:pt-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <span
            className={cn(
              "size-2.5 rounded-full",
              down > 0 ? "bg-destructive animate-pulse" : sites.length ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
            aria-hidden
          />
          <span className="font-medium">
            {down > 0
              ? `${down} of ${sites.length} down`
              : sites.length
                ? `All ${sites.length} sites up`
                : "No sites yet"}
          </span>
          <span className="text-xs text-muted-foreground">
            {up} up · {down} down
            {data ? ` · every ${data.intervalSeconds}s` : ""}
            {data?.lastSweepAt ? ` · swept ${relativeTime(data.lastSweepAt, now)}` : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={checking !== null || sites.length === 0}
            onClick={() => void check()}
          >
            <Icon
              name="RotateCcw"
              className={cn("size-4", checking === "all" && "animate-spin")}
            />
            Check all
          </Button>
        </div>

        <form onSubmit={add} className="flex items-center gap-2">
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="example.com or https://example.com/health"
            aria-label="Site URL"
          />
          <Button type="submit" disabled={pending || url.trim() === ""}>
            <Icon name="Plus" className="size-4" />
            Add
          </Button>
        </form>

        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {data === null ? (
          <EmptyState>Loading…</EmptyState>
        ) : sites.length === 0 ? (
          <EmptyState>
            No sites. Add one above or run <code>bb uptime add example.com</code>.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {sites.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                now={now}
                busy={checking === site.id || checking === "all"}
                onCheck={() => void check(site.id)}
                onRemove={() => {
                  rpc.call("sites_remove", { id: site.id }).then(refetch, report);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Sidebar accessory: red count when something is down, else green dot. */
function SidebarStatus() {
  const { data } = useSites();
  if (!data || data.sites.length === 0) return null;
  const down = data.sites.filter((s) => stateOf(s) === "down").length;
  if (down > 0) {
    return (
      <span className="rounded-full bg-destructive/15 px-1.5 text-xs font-medium tabular-nums text-destructive">
        {down} down
      </span>
    );
  }
  return <span className="inline-block size-2 rounded-full bg-emerald-500" aria-label="All up" />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "monitor",
    title: "Uptime",
    icon: "Globe",
    path: "monitor",
    component: MonitorPage,
    experimental_sidebarAccessory: SidebarStatus,
  });
});
