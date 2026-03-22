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

Matching is case-insensitive word-boundary search against a configurable list of identifiers (e.g. `sytze, @sytze`). Identifiers must be at least 3 characters to avoid false positives. The matcher checks that the identifier is bounded by non-alphanumeric characters (or start/end of string) to prevent substring false positives (e.g. "sy" matching "easy").

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

**Stream lifecycle:** On `setup()`, the worker reads all configured companies via `ctx.companies.list()` and calls `ctx.streams.open("notifications", companyId)` for each. The stream remains open for the lifetime of the worker. `close()` is not called — the host handles cleanup on worker shutdown.

### UI (browser-side, runs in Brave)

The stream listener must stay alive whenever any Paperclip page is open, not just when the settings page is mounted. To achieve this:

- The plugin registers a **`globalToolbarButton`** UI slot — a minimal, invisible component whose sole purpose is to subscribe to `usePluginStream("notifications")` and relay events to the Service Worker. This component mounts on every Paperclip page and stays alive as long as any tab is open.
- The **`settingsPage`** slot handles configuration (user ID, mention identifiers) and notification permission requests. It does not handle the stream subscription.

### Service Worker

- Registered by the `globalToolbarButton` component on first mount via `navigator.serviceWorker.register()`
- Scope: registered at the Paperclip app origin root (`/`) so `clients.matchAll()` can find any Paperclip tab
- Uses `skipWaiting()` and `clients.claim()` on install/activate to take control immediately
- Listens for `message` events from the UI relay component
- Shows OS notifications using `self.registration.showNotification()` with the issue title and excerpt
- On `notificationclick`, uses `clients.matchAll({ type: "window" })` to find an existing Paperclip tab. If found, focuses it and navigates to the issue URL. If none exists, opens a new tab via `clients.openWindow()`

### Data Flow

```
Issue event (DB) → Plugin Event Bus → Worker handler → ctx.streams.emit()
    → SSE → globalToolbarButton component → postMessage → Service Worker → OS Notification
```

## Notification Payload

```ts
{
  type: "assignment" | "mention",
  issueId: string,
  issueTitle: string,
  url: string,           // pre-built path: /<companyPrefix>/issues/<issueId>
  excerpt: string,
  occurredAt: string,
}
```

**`excerpt` rules:**
- For assignment notifications: first 100 characters of the issue description
- For mention notifications: up to 50 characters before and after the first match of the identifier, trimmed to word boundaries

The `url` field is constructed by the worker (which has access to company data), so the Service Worker can navigate directly without needing to resolve anything.

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
│   ├── constants.ts              # Plugin ID, version, stream channel name
│   ├── manifest.ts               # Capabilities, config schema, UI slots
│   ├── worker.ts                 # Event subscriptions, mention matching, stream emission
│   ├── mention-matcher.ts        # Word-boundary matching logic
│   └── ui/
│       ├── settings-page.tsx     # Config form + notification permission request
│       ├── notification-relay.tsx # globalToolbarButton: stream subscription + SW relay
│       ├── sw.ts                 # Service Worker: show notification, handle click
│       └── styles.ts             # Shared styling
└── tests/
    ├── mention-matcher.spec.ts
    └── worker.spec.ts
```

## Deduplication

Each notification is keyed by `eventId`. The worker stores notified event IDs in `ctx.state` with `scopeKind: "instance"` and `stateKey: "notified-<eventId>"`.

**Cleanup:** The worker runs a cleanup pass on startup and then every 24 hours. It deletes deduplication keys older than 7 days. Each stored value includes a `notifiedAt` timestamp to support this.

## Error Handling

- **`ctx.issues.get()` fails (issue deleted, network error):** Log a warning via `ctx.logger.warn()` and skip the notification. Do not retry.
- **`ctx.streams.emit()` with no UI connected:** This is a no-op by design — no error is thrown. The notification is simply lost if no browser tab is open. This is acceptable.
- **Notification permission denied or revoked:** The `notification-relay` component checks `Notification.permission` before attempting `postMessage`. If denied, it logs to console and does nothing. The settings page shows the current permission status and a button to re-request.
- **Service Worker fails to register:** The `notification-relay` component catches the registration error and logs it to console. Notifications degrade silently — the plugin continues to function without OS notifications.

## Browser Requirements

- Brave must be running with at least one Paperclip tab open (it does not need to be focused)
- Notification permission must be granted (prompted on first visit to the settings page)
- Service Worker registration persists across page navigations within Paperclip

## Build

Follows standard Paperclip plugin build pattern:
- `tsc` for the worker
- `esbuild` for the UI bundle
- Service Worker built as a separate esbuild entry point (runs in its own scope)
