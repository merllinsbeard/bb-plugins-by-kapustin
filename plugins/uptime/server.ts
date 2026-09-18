// bb-plugin-uptime — backend entry.
//
// A background service pings every monitored site on an interval, keeps a
// bounded check history per site in bb.storage.kv, and publishes a realtime
// signal after each sweep so open pages refresh. RPC serves the page; the
// `bb uptime` command serves agents and shells.
import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const checkSchema = z.object({
  at: z.number(),
  ok: z.boolean(),
  status: z.number().nullable(),
  ms: z.number(),
  error: z.string().nullable(),
});
export type Check = z.infer<typeof checkSchema>;

const siteSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  createdAt: z.number(),
  checks: z.array(checkSchema),
});
export type Site = z.infer<typeof siteSchema>;

const urlInput = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .transform((raw) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`))
  .pipe(z.url());

export const rpcContract = defineRpcContract({
  sites_list: {
    input: z.null(),
    output: z.object({
      sites: z.array(siteSchema),
      intervalSeconds: z.number(),
      lastSweepAt: z.number().nullable(),
    }),
  },
  sites_add: {
    input: z.object({ url: urlInput, name: z.string().trim().max(80).optional() }),
    output: siteSchema,
  },
  sites_remove: {
    input: z.object({ id: z.string() }),
    output: z.object({ removed: z.boolean() }),
  },
  sites_check: {
    input: z.object({ id: z.string().optional() }),
    output: z.object({ sites: z.array(siteSchema) }),
  },
});

const SITES_CHANGED = "sites-changed";
const HISTORY_LIMIT = 60;
const DEFAULT_SITES: Array<{ name: string; url: string }> = [];

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    intervalSeconds: {
      type: "number",
      label: "Check interval (seconds)",
      description: "How often every site is pinged.",
      default: 60,
    },
    timeoutMs: {
      type: "number",
      label: "Request timeout (ms)",
      default: 10_000,
    },
  });
  let { intervalSeconds, timeoutMs } = await settings.get();
  settings.onChange((next) => {
    intervalSeconds = next.intervalSeconds;
    timeoutMs = next.timeoutMs;
  });
  const interval = () => Math.max(10, intervalSeconds) * 1000;
  const timeout = () => Math.max(1000, timeoutMs);

  let lastSweepAt: number | null = null;

  async function readSites(): Promise<Site[]> {
    const stored = await bb.storage.kv.get<Site[]>("sites");
    if (stored !== undefined) return stored;
    const seeded = DEFAULT_SITES.map((s) => ({
      id: randomUUID().slice(0, 8),
      name: s.name,
      url: s.url,
      createdAt: Date.now(),
      checks: [],
    }));
    await bb.storage.kv.set("sites", seeded);
    return seeded;
  }
  async function writeSites(sites: Site[]): Promise<void> {
    await bb.storage.kv.set("sites", sites);
    bb.realtime.publish(SITES_CHANGED, { count: sites.length });
  }

  async function ping(url: string, signal?: AbortSignal): Promise<Check> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout());
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener("abort", onOuterAbort, { once: true });
    const started = performance.now();
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "bb-plugin-uptime/0.1" },
      });
      // Drain a little so keep-alive sockets are reusable; ignore the body.
      await res.body?.cancel().catch(() => undefined);
      return {
        at: Date.now(),
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        ms: Math.round(performance.now() - started),
        error: null,
      };
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.name === "AbortError"
            ? "timeout"
            : cause.message
          : String(cause);
      return {
        at: Date.now(),
        ok: false,
        status: null,
        ms: Math.round(performance.now() - started),
        error: message.slice(0, 200),
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  async function sweep(onlyId?: string, signal?: AbortSignal): Promise<Site[]> {
    const sites = await readSites();
    const targets = onlyId ? sites.filter((s) => s.id === onlyId) : sites;
    const results = await Promise.all(targets.map((s) => ping(s.url, signal)));
    targets.forEach((site, i) => {
      site.checks = [...site.checks, results[i]!].slice(-HISTORY_LIMIT);
      if (!results[i]!.ok) {
        bb.log.warn(`down: ${site.url} ${results[i]!.status ?? results[i]!.error}`);
      }
    });
    if (!onlyId) lastSweepAt = Date.now();
    await writeSites(sites);
    return sites;
  }

  async function addSite(url: string, name?: string): Promise<Site> {
    const sites = await readSites();
    const existing = sites.find((s) => s.url === url);
    if (existing) return existing;
    const site: Site = {
      id: randomUUID().slice(0, 8),
      name: name && name !== "" ? name : new URL(url).hostname,
      url,
      createdAt: Date.now(),
      checks: [],
    };
    sites.push(site);
    await writeSites(sites);
    site.checks = [await ping(url)];
    await writeSites(sites);
    return site;
  }
  async function removeSite(id: string): Promise<boolean> {
    const sites = await readSites();
    const remaining = sites.filter((s) => s.id !== id);
    if (remaining.length === sites.length) return false;
    await writeSites(remaining);
    return true;
  }

  bb.rpc.register(rpcContract, {
    sites_list: async () => ({
      sites: await readSites(),
      intervalSeconds: interval() / 1000,
      lastSweepAt,
    }),
    sites_add: ({ url, name }) => addSite(url, name),
    sites_remove: async ({ id }) => ({ removed: await removeSite(id) }),
    sites_check: async ({ id }) => ({ sites: await sweep(id) }),
  });

  bb.background.service("pinger", {
    async start(signal) {
      while (!signal.aborted) {
        try {
          await sweep(undefined, signal);
        } catch (cause) {
          bb.log.error(`sweep failed: ${String(cause)}`);
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, interval());
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    },
  });

  const usage = [
    "Usage:",
    "  bb uptime list [--json]",
    "  bb uptime add <url> [name] [--json]",
    "  bb uptime remove <site-id> [--json]",
    "  bb uptime check [site-id] [--json]",
  ].join("\n");
  function formatSite(site: Site): string {
    const last = site.checks.at(-1);
    const state = !last ? "?" : last.ok ? "UP  " : "DOWN";
    const detail = !last
      ? "no checks yet"
      : `${last.status ?? last.error} ${last.ms}ms`;
    const up = site.checks.filter((c) => c.ok).length;
    const pct = site.checks.length ? Math.round((100 * up) / site.checks.length) : 0;
    return `${state} ${site.id}  ${site.name.padEnd(24)} ${detail}  (${pct}% of last ${site.checks.length})`;
  }
  bb.cli.register({
    name: "uptime",
    summary: "Monitor website availability",
    commands: [
      { name: "list", summary: "List sites and their status", usage: "bb uptime list [--json]" },
      { name: "add", summary: "Add a site", usage: "bb uptime add <url> [name] [--json]" },
      { name: "remove", summary: "Remove a site", usage: "bb uptime remove <site-id> [--json]" },
      { name: "check", summary: "Ping now", usage: "bb uptime check [site-id] [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...args] = argv.filter((arg) => arg !== "--json");
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value) : text,
      });
      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
        case "list": {
          const sites = await readSites();
          return reply(sites, sites.length ? sites.map(formatSite).join("\n") : "No sites.");
        }
        case "add": {
          const parsed = urlInput.safeParse(args[0] ?? "");
          if (!parsed.success) return { exitCode: 1, stderr: `Invalid URL.\n${usage}` };
          const site = await addSite(parsed.data, args.slice(1).join(" ").trim());
          return reply(site, formatSite(site));
        }
        case "remove": {
          if (!args[0]) break;
          if (!(await removeSite(args[0]))) return { exitCode: 1, stderr: `No site ${args[0]}` };
          return reply({ removed: true, id: args[0] }, `Removed ${args[0]}`);
        }
        case "check": {
          const sites = await sweep(args[0]);
          const shown = args[0] ? sites.filter((s) => s.id === args[0]) : sites;
          if (args[0] && shown.length === 0) return { exitCode: 1, stderr: `No site ${args[0]}` };
          const anyDown = shown.some((s) => s.checks.at(-1)?.ok === false);
          return { ...reply(shown, shown.map(formatSite).join("\n")), exitCode: anyDown ? 2 : 0 };
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
