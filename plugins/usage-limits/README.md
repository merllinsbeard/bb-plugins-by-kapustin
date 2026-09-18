# bb-plugin-usage-limits

Shows agent-provider usage limits in the bb sidebar:

- **One-line bar** above the footer icons: provider icon · weekly used % ·
  time until reset, one chip per account. Click it for details.
- **Centered dialog** (also from the "Usage limits" footer icon) with every
  window on every host and a refresh button.
- **CLI** `bb usage-limits [--all] [--force] [--json]` for shells and agents.

Data comes from `bb.sdk.system.usageLimits`, i.e. the same provider bridges bb
already uses, so no extra credentials are needed. Results are cached for
5 minutes (setting `cacheMinutes`), shortened to 1 minute after a thread
finishes.

## Develop

```
npm install --include=dev
bb plugin install .
bb plugin dev
```
