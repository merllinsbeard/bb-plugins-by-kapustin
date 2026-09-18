---
name: uptime
description: Check website availability, manage monitored sites, and inspect latency and recent check history.
---

# Uptime plugin

Pings every monitored site every `intervalSeconds` (default 60) with a GET
and keeps the last 60 checks per site. Page: sidebar → **Uptime**
(`/plugins/uptime/monitor`).

## Commands

```
bb uptime list [--json]              # status of all sites
bb uptime add <url> [name] [--json]  # add + ping immediately (dedupes by url)
bb uptime remove <site-id> [--json]
bb uptime check [site-id] [--json]   # ping now; exit 2 if anything is down
```

`--json` returns `Site[]`: `{ id, name, url, createdAt, checks: [{ at, ok,
status, ms, error }] }`. A site is "up" when the final response is 2xx/3xx.

## Settings

`bb plugin config uptime` — `intervalSeconds` (min 10), `timeoutMs`.

## Notes

- Checks run inside the bb server; sites must be reachable from that machine.
- Bounded history: 60 checks per site. Not an alerting system.
