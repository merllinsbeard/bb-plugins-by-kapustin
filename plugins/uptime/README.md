# Uptime

Website availability monitor for bb.

- Background service pings every site on an interval (default 60s, GET, follows
  redirects, 10s timeout). Up = final status 2xx/3xx.
- **Uptime** page in the sidebar: overall banner, per-site cards with latency
  history bars (last 60 checks), uptime %, avg latency, last error.
- Sidebar accessory: green dot when all up, red `N down` otherwise.
- `bb uptime list|add|remove|check` for shells and agents (`--json` supported;
  `check` exits 2 when anything is down).

Starts with an empty site list. Add only the websites you want to monitor.

## Settings

`bb plugin config uptime` — `intervalSeconds` (min 10), `timeoutMs`.

## Develop

```
npm install --include=dev --ignore-scripts
bb plugin dev
```
