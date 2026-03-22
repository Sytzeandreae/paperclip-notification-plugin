# Paperclip Notifications Plugin — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Goal

Send OS notifications when an issue in Paperclip requires the user's attention. Clicking a notification navigates to the relevant issue in the browser.

## Context

Paperclip is a self-hosted AI agent orchestration platform running on a VPS. The user accesses it via Brave Browser on their local machine. There is no existing notification mechanism for human users.

## Trigger Conditions

A notification is sent when:

1. **Issue assigned to me** — an issue is created or updated with my user ID as the assignee
2. **Mention in issue** — my name/username appears in a newly created issue's title or description
3. **Mention in comment** — my name/username appears in a new comment on any issue
4. **Mention in update** — my name/username appears in an updated issue's description

Matching is case-insensitive substring search against a configurable list of identifiers (e.g. `sytze, @sytze`).

## Architecture

### Worker (server-side, runs on VPS)

- Subscribes to three Paperclip domain events via `ctx.events.on()`:
  - `issue.created`
  - `issue.updated`
  - `issue.comment.created`
- When an event fires, fetches the full issue (and comment if applicable) via `ctx.issues`
- Checks assignment and mention conditions
- If matched, pushes a notification payload to the UI via `ctx.streams.emit("notifications", payload)`
- Stores notified event IDs in `ctx.state` (instance-scoped) for deduplication

### UI (browser-side, runs in Brave)

- Registers a settings page for configuring user ID and mention identifiers
- On mount, requests browser notification permission
- Subscribes to the `"notifications"` stream via `usePluginStream("notifications")`
- Relays stream events to a Service Worker via `postMessage()`

### Service Worker

- Receives notification payloads from the UI via `message` events
- Shows OS notifications using `self.registration.showNotification()`
- On click, uses `clients.matchAll()` to find an existing Paperclip tab and navigate it to the issue. If none exists, opens a new tab with `clients.openWindow()`

### Data Flow

```
Issue event (DB) → Plugin Event Bus → Worker handler → ctx.streams.emit()
    → SSE → UI component → postMessage → Service Worker → OS Notification
```

## Notification Payload

```ts
{
  type: "assignment" | "mention",
  issueId: string,
  issueTitle: string,
  companyPrefix: string,
  excerpt: string,       // first ~100 chars of the relevant text
  occurredAt: string,
}
```

## Plugin Capabilities

- `events.subscribe` — listen for issue/comment events
- `issues.read` — fetch issue details
- `issue.comments.read` — read comment content
- `plugin.state.read` / `plugin.state.write` — deduplication state
- `companies.read` — resolve company prefix for URL construction
- `instance.settings.register` — settings page
- `ui.page.register` — mount settings UI

## Configuration

Settings page with:

- **User ID** — the user's Paperclip user ID (for assignment detection)
- **Mention identifiers** — comma-separated list of strings to match (e.g. `sytze, @sytze`)

Stored in `instanceConfigSchema` on the manifest.

## File Structure

```
paperclip-notifications/
├── .gitignore
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── scripts/
│   └── build-ui.mjs
├── src/
│   ├── constants.ts          # Plugin ID, version, stream channel name
│   ├── manifest.ts           # Capabilities, config schema, UI slots
│   ├── worker.ts             # Event subscriptions, mention matching, stream emission
│   ├── mention-matcher.ts    # Case-insensitive matching logic
│   └── ui/
│       ├── settings-page.tsx # Config form + notification permission + stream relay
│       ├── sw.ts             # Service Worker: show notification, handle click
│       └── styles.ts         # Shared styling
└── tests/
    ├── mention-matcher.spec.ts
    └── worker.spec.ts
```

## Deduplication

Each notification is keyed by `(issueId, eventId)`. The worker stores notified event IDs in `ctx.state` with `scopeKind: "instance"` and `stateKey: "notified-<eventId>"`. This prevents re-notification on worker restarts.

## Browser Requirements

- Brave must be running (not necessarily with Paperclip tab in focus)
- Notification permission must be granted on first visit to the settings page
- Service Worker registration persists across tab closes as long as Brave is running

## Build

Follows standard Paperclip plugin build pattern:
- `tsc` for the worker
- `esbuild` for the UI bundle
- Service Worker built as a separate esbuild entry point (runs in its own scope)
