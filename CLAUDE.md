# Paperclip Notifications Plugin

A Paperclip AI plugin that sends OS notifications when issues are assigned to or mention a configured user.

## Project Structure

- `src/` — TypeScript source
  - `worker.ts` — Server-side: event subscriptions, matching, stream emission
  - `manifest.ts` — Plugin manifest (capabilities, config, UI slots)
  - `mention-matcher.ts` — Word-boundary mention matching
  - `types.ts` — Shared types (NotificationPayload)
  - `constants.ts` — Plugin ID, version, stream channel
  - `ui/` — Browser-side React components + Service Worker
- `tests/` — Vitest tests
- `scripts/` — Build scripts (esbuild for UI)
- `docs/superpowers/` — Design spec and implementation plan

## Tech Stack

- TypeScript (ES2022, Node16 modules)
- React (JSX) for plugin UI
- Paperclip Plugin SDK (`@paperclipai/plugin-sdk`)
- Service Worker + Web Notifications API
- esbuild (UI bundling), tsc (worker)
- vitest (testing)

## Commands

```bash
pnpm install          # Install dependencies
pnpm test             # Run tests (vitest)
pnpm test:watch       # Run tests in watch mode
pnpm typecheck        # Type check without emitting
pnpm build            # Build worker (tsc) + UI (esbuild)
pnpm dev              # Watch mode for worker
```

## Plugin SDK Patterns

- Worker entry: `definePlugin({ setup(ctx) { ... } })` + `runWorker(plugin, import.meta.url)`
- Events: `ctx.events.on("issue.created", async (event) => { ... })`
- Streams (worker → UI): `ctx.streams.open(channel, companyId)` / `ctx.streams.emit(channel, payload)`
- State: `ctx.state.get/set/delete({ scopeKind, stateKey })`
- UI hooks: `usePluginData`, `usePluginAction`, `usePluginStream`, `useHostContext`, `usePluginToast`
- UI slots: `settingsPage`, `globalToolbarButton`

## Install into Paperclip (local dev)

```bash
curl -X POST http://<host>:3100/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"packageName": "/absolute/path/to/paperclip-notifications", "isLocalPath": true}'
```

## Key Design Decisions

- **globalToolbarButton** for the stream relay — mounts on every page so SSE stays alive
- **Service Worker** for OS notifications — works even when Paperclip tab isn't focused
- **Word-boundary matching** (not substring) to avoid false positives on short identifiers
- **Dedup index** in `ctx.state` with 7-day TTL cleanup to prevent unbounded state growth
