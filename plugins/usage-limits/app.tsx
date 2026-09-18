// bb-plugin-usage-limits — frontend entry.
//
// Surfaces (all fed by one store in lib/usage-store.ts):
//   1. A content script keeps an empty container as the first child of the
//      sidebar footer (above the icon row) and publishes it to the store.
//   2. An app overlay slot (always mounted) portals a one-line React bar into
//      that container — provider icon · used % · time to reset — and owns a
//      centered dialog with the full breakdown, opened by clicking the bar.
//   3. A footer action icon that opens the same dialog.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  experimental_ProviderIcon as ProviderIcon,
  useRealtime,
} from "@get-bb/plugin-sdk/app";
import type { UsageProvider, UsageWindow } from "./server";
import {
  formatReset,
  formatResetShort,
  getBarHost,
  getUsageState,
  isOverlayOpen,
  refreshUsage,
  setBarHost,
  setOverlayOpen,
  subscribeBarHost,
  subscribeOverlay,
  subscribeUsage,
  toneColor,
  toneFor,
  type UsageState,
} from "@/lib/usage-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const REFRESH_MS = 5 * 60_000;
const BAR_HOST_ID = "usage-limits-bar-host";
const FOOTER_SELECTOR = 'div[data-sidebar="footer"]';

// ---------------------------------------------------------------------------
// Content script: keep the container in the footer + refresh loop
// ---------------------------------------------------------------------------

function mountBarHost({ signal }: { signal: AbortSignal }) {
  const host = document.createElement("div");
  host.id = BAR_HOST_ID;
  host.style.minWidth = "0";

  const attach = () => {
    if (signal.aborted) return;
    const footer = document.querySelector(FOOTER_SELECTOR);
    if (footer === null) {
      host.remove();
      setBarHost(null);
      return;
    }
    const collapsed =
      footer.closest('[data-state="collapsed"]') !== null ||
      footer.getBoundingClientRect().width < 120;
    host.style.display = collapsed ? "none" : "block";
    if (host.parentElement !== footer || footer.firstChild !== host) {
      footer.insertBefore(host, footer.firstChild);
    }
    setBarHost(host);
  };
  attach();
  const observer = new MutationObserver(attach);
  observer.observe(document.body, { childList: true, subtree: true });
  const resize = new ResizeObserver(attach);
  resize.observe(document.body);

  let timer: number | null = null;
  const schedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (signal.aborted || document.visibilityState !== "visible") return;
    timer = window.setTimeout(() => {
      void refreshUsage({ signal });
      schedule();
    }, REFRESH_MS);
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") void refreshUsage({ signal });
    schedule();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onVisibility);
  void refreshUsage({ signal });
  schedule();

  return () => {
    observer.disconnect();
    resize.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onVisibility);
    if (timer !== null) window.clearTimeout(timer);
    setBarHost(null);
    host.remove();
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useUsage(): UsageState {
  const state = useSyncExternalStore(subscribeUsage, getUsageState);
  useRealtime("usage-changed", () => {
    void refreshUsage();
  });
  return state;
}

/** Re-render once a minute so "resets in" stays fresh. */
function useMinuteTick() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
}

// ---------------------------------------------------------------------------
// One-line bar
// ---------------------------------------------------------------------------

interface Chip {
  key: string;
  provider: UsageProvider;
  window: UsageWindow;
}

/** One chip per (provider, account): the weekly window, else the first one. */
function chipsFor(state: UsageState): Chip[] {
  const chips: Chip[] = [];
  const seen = new Set<string>();
  for (const provider of state.data?.providers ?? []) {
    if (provider.status !== "ok" || provider.windows.length === 0) continue;
    const key = `${provider.id}/${provider.accountEmail ?? provider.hostId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const window =
      provider.windows.find((candidate) => candidate.weekly) ??
      provider.windows[0]!;
    chips.push({ key, provider, window });
  }
  return chips;
}

function ProviderMark({
  provider,
  className,
}: {
  provider: UsageProvider;
  className?: string;
}) {
  return (
    <ProviderIcon
      providerKind="agent"
      provider={{
        id: provider.id,
        logoUrl: provider.logoUrl,
        icon: provider.icon,
        strings: { iconTint: provider.iconTint },
      }}
      className={cn("size-3.5 shrink-0", className)}
      aria-hidden
    />
  );
}

type TokenTotals = { day: number; month: number; timeZone: string; fetchedAt: string | null; error: string | null };

function useTokenTotals() {
  const [tokens, setTokens] = useState<TokenTotals | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const response = await fetch("/api/v1/plugins/usage-limits/rpc/getTokens", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error("Token usage unavailable");
        if (!controller.signal.aborted) setTokens(body.result);
      } catch {
        if (!controller.signal.aborted) setTokens((prior) => ({
          day: 0, month: 0, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          fetchedAt: null, ...prior, error: "Не удалось обновить расход токенов",
        }));
      } finally { pending = false; }
    };
    const onVisible = () => { void refresh(); };
    void refresh();
    const timer = window.setInterval(onVisible, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      controller.abort(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);
  return tokens;
}

const compactTokens = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

function UsageBar({ tokens }: { tokens: TokenTotals | null }) {
  const state = useUsage();
  useMinuteTick();
  const chips = chipsFor(state);
  const open = () => setOverlayOpen(true);
  const empty =
    chips.length === 0
      ? state.error
        ? "Usage unavailable"
        : state.loading
          ? "Loading usage…"
          : "No usage limits"
      : null;
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Лимиты и расход токенов BB. Открыть подробности."
      title="Usage limits — click for details"
      className="mb-1 flex w-full min-w-0 cursor-pointer items-center justify-start gap-2 flex-wrap rounded-md px-1.5 py-1 text-[11px] leading-none text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      {empty !== null ? (
        <span className="truncate text-muted-foreground">{empty}</span>
      ) : (
        chips.map(({ key, provider, window }) => {
          const tone = toneFor(window.usedPercent);
          const reset = formatResetShort(window.resetsAt);
          return (
            <span
              key={key}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap"
              title={`${provider.displayName} — ${window.label}: ${Math.round(window.usedPercent)}%${reset ? `, resets in ${formatReset(window.resetsAt)}` : ""}`}
            >
              <ProviderMark provider={provider} />
              <span
                className="font-semibold tabular-nums"
                style={{ color: toneColor(tone) }}
              >
                {Math.round(window.usedPercent)}%
              </span>
              {reset ? (
                <span className="text-muted-foreground tabular-nums">{reset}</span>
              ) : null}
            </span>
          );
        })
      )}
      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums" title={tokens?.fetchedAt ? `Токены по всему BB: сегодня ${tokens.day.toLocaleString("ru-RU")}, месяц ${tokens.month.toLocaleString("ru-RU")}. ${tokens.timeZone}${tokens.error ? `. ${tokens.error}` : ""}` : tokens?.error ?? "Загрузка расхода токенов"}>
        <span aria-hidden="true" className="font-semibold">Σ</span>
        {tokens?.fetchedAt ? <span>{compactTokens(tokens.day)}<span className="text-muted-foreground"> д / </span>{compactTokens(tokens.month)}<span className="text-muted-foreground"> мес</span>{tokens.error ? " ⚠" : ""}</span> : <span className="text-muted-foreground">{tokens?.error ? "—" : "…"}</span>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Centered dialog with the full breakdown
// ---------------------------------------------------------------------------

function WindowRow({ window }: { window: UsageWindow }) {
  const tone = toneFor(window.usedPercent);
  const reset = formatReset(window.resetsAt);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate">{window.label}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {reset ? `resets in ${reset}` : ""}
        </span>
        <span
          className="w-10 shrink-0 text-right font-semibold tabular-nums"
          style={{ color: toneColor(tone) }}
        >
          {Math.round(window.usedPercent)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${Math.max(0, Math.min(100, window.usedPercent))}%`,
            background: toneColor(tone),
          }}
        />
      </div>
    </div>
  );
}

function ProviderBlock({
  provider,
  showHost,
}: {
  provider: UsageProvider;
  showHost: boolean;
}) {
  const subtitle = [
    provider.planLabel,
    provider.accountEmail,
    showHost ? provider.hostName : null,
  ]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ");
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <ProviderMark provider={provider} className="size-4" />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{provider.displayName}</span>
          {subtitle ? (
            <span className="truncate text-[11px] text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </div>
      </div>
      {provider.status === "ok" ? (
        provider.windows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No limit windows reported.</p>
        ) : (
          provider.windows.map((window) => (
            <WindowRow key={window.label} window={window} />
          ))
        )
      ) : (
        <p className="text-xs text-muted-foreground">
          {provider.status === "not_installed"
            ? "CLI not installed on this host."
            : provider.status === "unauthenticated"
              ? "Not signed in. Sign in, then refresh."
              : provider.status === "expired"
                ? "Session expired. Sign in again, then refresh."
                : (provider.message ?? "Usage could not be loaded.")}
        </p>
      )}
    </div>
  );
}

function UsageDialog({ tokens }: { tokens: TokenTotals | null }) {
  const open = useSyncExternalStore(subscribeOverlay, isOverlayOpen);
  const state = useUsage();
  useMinuteTick();
  // Same account on several hosts reports one quota: keep the first "ok"
  // entry per (provider, account); keep every non-ok entry (they are per host).
  const seenAccounts = new Set<string>();
  const providers = (state.data?.providers ?? []).filter((provider) => {
    if (provider.status !== "ok" || provider.accountEmail === null) return true;
    const key = `${provider.id}/${provider.accountEmail}`;
    if (seenAccounts.has(key)) return false;
    seenAccounts.add(key);
    return true;
  });
  const hostCount = new Set(providers.map((provider) => provider.hostId)).size;
  return (
    <Dialog open={open} onOpenChange={setOverlayOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Usage limits
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Refresh usage"
              disabled={state.loading}
              onClick={() => {
                void refreshUsage({ force: true });
              }}
            >
              <Icon
                name="ArrowReloadHorizontal"
                className={state.loading ? "size-4 animate-spin" : "size-4"}
              />
            </Button>
          </DialogTitle>
          <DialogDescription>
            {state.data
              ? `Updated ${new Date(state.data.fetchedAt).toLocaleTimeString()}`
              : "Loading usage…"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <section className="rounded-lg border p-3" aria-label="Расход токенов по всему BB">
            <h3 className="text-sm font-semibold">Токены · весь BB</h3>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm tabular-nums">
              <div><dt className="text-muted-foreground">Сегодня</dt><dd className="font-semibold">{tokens?.fetchedAt ? tokens.day.toLocaleString("ru-RU") : "—"}</dd></div>
              <div><dt className="text-muted-foreground">Этот месяц</dt><dd className="font-semibold">{tokens?.fetchedAt ? tokens.month.toLocaleString("ru-RU") : "—"}</dd></div>
            </dl>
            <p className="mt-2 text-[11px] text-muted-foreground">Все проекты, архивные чаты и скрытые агенты. Учтён расход, который провайдеры передали в историю BB. Кэш и reasoning повторно не прибавляются.</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{tokens?.timeZone ?? ""}{tokens?.fetchedAt ? ` · Обновлено ${new Date(tokens.fetchedAt).toLocaleTimeString()}` : " · Загрузка…"}</p>
            {tokens?.error ? <p role="status" className="mt-1 text-xs text-muted-foreground">{tokens.error}</p> : null}
          </section>
          {providers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {state.error ?? (state.loading ? "Loading…" : "No providers with usage reporting.")}
            </p>
          ) : (
            providers.map((provider) => (
              <ProviderBlock
                key={`${provider.hostId}/${provider.id}`}
                provider={provider}
                showHost={hostCount > 1}
              />
            ))
          )}
          {state.error !== null && providers.length > 0 ? (
            <p role="status" className="text-[11px] text-muted-foreground">
              Showing the last update. {state.error}
            </p>
          ) : null}
          {state.data?.error ? (
            <p role="status" className="text-[11px] text-muted-foreground">
              {state.data.error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Always-mounted overlay: portals the bar into the footer + owns the dialog. */
function UsageOverlay() {
  const tokens = useTokenTotals();
  const host = useSyncExternalStore(subscribeBarHost, getBarHost);
  return (
    <>
      {host === null ? null : createPortal(<UsageBar tokens={tokens} />, host)}
      <UsageDialog tokens={tokens} />
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "usage", component: UsageOverlay });
  app.contentScripts.register({ id: "bar-host", mount: mountBarHost });
  app.experimental_sidebarFooter.register({
    kind: "action",
    id: "usage",
    label: "Usage limits",
    icon: "ChartColumn",
    onActivate: () => setOverlayOpen(true),
  });
});
