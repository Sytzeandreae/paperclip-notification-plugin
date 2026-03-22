# Paperclip Notifications Plugin Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Paperclip plugin that sends OS notifications when issues are assigned to or mention a configured user.

**Architecture:** A plugin worker subscribes to Paperclip domain events (`issue.created`, `issue.updated`, `issue.comment.created`) and checks for assignment or mention matches. Matched events are pushed to the browser via `ctx.streams`. A React relay component forwards events to a Service Worker, which shows OS notifications. Clicking a notification navigates to the issue.

**Tech Stack:** TypeScript, React, Paperclip Plugin SDK (`@paperclipai/plugin-sdk`), Service Worker API, Web Notifications API, esbuild, vitest

**Spec:** `docs/superpowers/specs/2026-03-22-notifications-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `.gitignore` | Ignore `dist/`, `node_modules/`, `.paperclip-sdk/` |
| `package.json` | Package metadata, dependencies, build scripts |
| `tsconfig.json` | TypeScript config (ES2022, Node16, react-jsx) |
| `vitest.config.ts` | Test runner config |
| `scripts/build-ui.mjs` | esbuild: bundle UI components + Service Worker |
| `src/constants.ts` | Plugin ID, version, stream channel name |
| `src/types.ts` | Shared `NotificationPayload` interface |
| `src/mention-matcher.ts` | Word-boundary matching logic |
| `src/manifest.ts` | Plugin manifest (capabilities, config schema, UI slots) |
| `src/worker.ts` | Event subscriptions, matching, stream emission, dedup |
| `src/ui/index.tsx` | UI entry point: re-exports SettingsPage and NotificationRelay |
| `src/ui/settings-page.tsx` | Config form + notification permission UI |
| `src/ui/notification-relay.tsx` | globalToolbarButton: stream → Service Worker relay |
| `src/ui/sw.ts` | Service Worker: notification display + click navigation |
| `src/ui/styles.ts` | Shared inline styles |
| `tests/mention-matcher.spec.ts` | Tests for mention matching |
| `tests/worker.spec.ts` | Tests for worker event handling |

---

## Chunk 1: Project Scaffold & Mention Matcher

### Task 1: Project scaffold

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/constants.ts`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
.paperclip-sdk/
*.tsbuildinfo
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "paperclip-plugin-notifications",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "paperclipPlugin": {
    "manifest": "./dist/manifest.js",
    "worker": "./dist/worker.js",
    "ui": "./dist/ui/"
  },
  "scripts": {
    "build": "tsc && node ./scripts/build-ui.mjs",
    "typecheck": "tsc --noEmit",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@paperclipai/plugin-sdk": "workspace:*",
    "@paperclipai/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^19.0.8",
    "esbuild": "^0.24.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts"],
  },
});
```

- [ ] **Step 5: Create `src/constants.ts`**

```ts
export const PLUGIN_ID = "notifications";
export const PLUGIN_VERSION = "0.1.0";
export const STREAM_CHANNEL = "notifications";
```

- [ ] **Step 6: Create `src/types.ts`**

```ts
export interface NotificationPayload {
  type: "assignment" | "mention";
  issueId: string;
  issueTitle: string;
  url: string;
  excerpt: string;
  occurredAt: string;
}
```

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json tsconfig.json vitest.config.ts src/constants.ts src/types.ts
git commit -m "chore: scaffold project with package.json, tsconfig, vitest, shared types"
```

---

### Task 2: Mention matcher — tests

**Files:**
- Create: `tests/mention-matcher.spec.ts`

- [ ] **Step 1: Write tests for mention matching**

```ts
import { describe, it, expect } from "vitest";
import { matchesMention, extractExcerpt } from "../src/mention-matcher.js";

describe("matchesMention", () => {
  it("matches identifier at start of text", () => {
    expect(matchesMention("sytze is working on this", ["sytze"])).toBe(true);
  });

  it("matches identifier at end of text", () => {
    expect(matchesMention("assigned to sytze", ["sytze"])).toBe(true);
  });

  it("matches identifier in middle of text", () => {
    expect(matchesMention("hey sytze check this", ["sytze"])).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesMention("Hey SYTZE check this", ["sytze"])).toBe(true);
  });

  it("matches @-prefixed identifiers", () => {
    expect(matchesMention("cc @sytze for review", ["@sytze"])).toBe(true);
  });

  it("does not match substring within a word", () => {
    expect(matchesMention("easy task", ["sy"])).toBe(false);
  });

  it("rejects identifiers shorter than 3 characters", () => {
    expect(matchesMention("sy is here", ["sy"])).toBe(false);
  });

  it("matches any identifier from the list", () => {
    expect(matchesMention("hello sytze_a", ["bob", "sytze_a"])).toBe(true);
  });

  it("returns false when no match", () => {
    expect(matchesMention("nothing here", ["sytze"])).toBe(false);
  });

  it("handles empty text", () => {
    expect(matchesMention("", ["sytze"])).toBe(false);
  });

  it("handles empty identifiers list", () => {
    expect(matchesMention("sytze is here", [])).toBe(false);
  });
});

describe("extractExcerpt", () => {
  it("extracts context around first match", () => {
    const text = "This is a long description where sytze is mentioned somewhere in the middle of it all.";
    const result = extractExcerpt(text, ["sytze"]);
    expect(result).toContain("sytze");
    expect(result.length).toBeLessThanOrEqual(110); // ~50 before + identifier + ~50 after + some slack
  });

  it("returns first 100 chars when no identifiers provided", () => {
    const text = "A".repeat(200);
    const result = extractExcerpt(text, []);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it("handles match at start of text", () => {
    const text = "sytze started the project and continued working on it for many days.";
    const result = extractExcerpt(text, ["sytze"]);
    expect(result).toContain("sytze");
  });

  it("handles match at end of text", () => {
    const text = "The project was started by sytze";
    const result = extractExcerpt(text, ["sytze"]);
    expect(result).toContain("sytze");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mention-matcher.spec.ts`
Expected: FAIL — module `../src/mention-matcher.js` not found

- [ ] **Step 3: Commit**

```bash
git add tests/mention-matcher.spec.ts
git commit -m "test: add mention-matcher tests"
```

---

### Task 3: Mention matcher — implementation

**Files:**
- Create: `src/mention-matcher.ts`

- [ ] **Step 1: Implement `matchesMention` and `extractExcerpt`**

```ts
/**
 * Case-insensitive word-boundary matching for mention identifiers.
 * Identifiers shorter than 3 characters are rejected.
 */
export function matchesMention(text: string, identifiers: string[]): boolean {
  if (!text || identifiers.length === 0) return false;

  const lowerText = text.toLowerCase();

  for (const id of identifiers) {
    if (id.length < 3) continue;

    const lowerIdent = id.toLowerCase();
    // Escape special regex characters in the identifier
    const escaped = lowerIdent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word-boundary: bounded by non-alphanumeric or start/end of string.
    // We use a custom boundary since \b doesn't handle @ well.
    const pattern = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`);
    if (pattern.test(lowerText)) return true;
  }

  return false;
}

/**
 * Extract a short excerpt around the first mention match.
 *
 * - If identifiers are provided and a match is found: ~50 chars before and
 *   after the match, trimmed to word boundaries.
 * - Otherwise: first 100 characters of the text.
 */
export function extractExcerpt(text: string, identifiers: string[]): string {
  if (!text) return "";

  // Try to find the first word-boundary match position
  for (const id of identifiers) {
    if (id.length < 3) continue;

    const escaped = id.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`, "i");
    const match = pattern.exec(text);
    if (!match) continue;

    // Adjust index: the match may include a leading boundary char
    const idx = match[0].startsWith(id.charAt(0).toLowerCase()) || match[0].startsWith(id.charAt(0).toUpperCase())
      ? match.index
      : match.index + 1;

    const start = Math.max(0, idx - 50);
    const end = Math.min(text.length, idx + id.length + 50);
    let excerpt = text.slice(start, end);

    // Trim to word boundaries
    if (start > 0) {
      const spaceIdx = excerpt.indexOf(" ");
      if (spaceIdx !== -1 && spaceIdx < 10) {
        excerpt = excerpt.slice(spaceIdx + 1);
      }
    }
    if (end < text.length) {
      const lastSpace = excerpt.lastIndexOf(" ");
      if (lastSpace !== -1 && lastSpace > excerpt.length - 10) {
        excerpt = excerpt.slice(0, lastSpace);
      }
    }

    return excerpt;
  }

  // Fallback: first 100 characters
  return text.slice(0, 100);
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/mention-matcher.spec.ts`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/mention-matcher.ts
git commit -m "feat: implement word-boundary mention matcher with excerpt extraction"
```

---

## Chunk 2: Plugin Manifest & Worker

### Task 4: Manifest

**Files:**
- Create: `src/manifest.ts`

- [ ] **Step 1: Create the plugin manifest**

```ts
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { PLUGIN_ID, PLUGIN_VERSION } from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Notifications",
  description:
    "Sends OS notifications when issues are assigned to or mention a configured user.",
  author: "sorrel",
  categories: ["automation"],
  capabilities: [
    "events.subscribe",
    "issues.read",
    "issue.comments.read",
    "plugin.state.read",
    "plugin.state.write",
    "companies.read",
    "instance.settings.register",
    "ui.page.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui/",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        title: "User ID",
        description: "Your Paperclip user ID (for assignment detection).",
      },
      mentionIdentifiers: {
        type: "string",
        title: "Mention Identifiers",
        description:
          "Comma-separated list of names/usernames to match (e.g. sytze, @sytze). Min 3 characters each.",
        default: "",
      },
    },
  },
  tools: [],
  ui: {
    slots: [
      {
        type: "settingsPage",
        id: "notification-settings",
        displayName: "Notifications",
        exportName: "SettingsPage",
      },
      {
        type: "globalToolbarButton",
        id: "notification-relay",
        displayName: "Notifications",
        exportName: "NotificationRelay",
      },
    ],
  },
};

export default manifest;
```

- [ ] **Step 2: Commit**

```bash
git add src/manifest.ts
git commit -m "feat: add plugin manifest with capabilities and UI slots"
```

---

### Task 5: Worker — tests

**Files:**
- Create: `tests/worker.spec.ts`

The worker depends on `PluginContext` which we mock. We test the core logic: given an event, does it emit the right notification (or skip)?

- [ ] **Step 1: Write worker event handling tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the handler logic extracted into a testable function.
// The worker.ts will export `handleIssueEvent` and `handleCommentEvent` for testing.
import { handleIssueEvent, handleCommentEvent } from "../src/worker.js";

function mockCtx(overrides: Record<string, unknown> = {}) {
  return {
    issues: {
      get: vi.fn(),
      listComments: vi.fn(),
    },
    companies: {
      get: vi.fn().mockResolvedValue({ id: "co-1", prefix: "acme" }),
    },
    streams: {
      emit: vi.fn(),
    },
    state: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    ...overrides,
  };
}

const baseEvent = {
  eventId: "evt-1",
  eventType: "issue.created" as const,
  occurredAt: new Date().toISOString(),
  companyId: "co-1",
  entityId: "iss-1",
  entityType: "issue",
  payload: {},
};

const config = {
  userId: "user-1",
  mentionIdentifiers: ["sytze", "@sytze"],
};

describe("handleIssueEvent", () => {
  it("emits assignment notification when issue is assigned to user", async () => {
    const ctx = mockCtx();
    ctx.issues.get.mockResolvedValue({
      id: "iss-1",
      title: "Fix login bug",
      description: "The login page is broken.",
      assigneeUserId: "user-1",
    });

    await handleIssueEvent(ctx as any, baseEvent as any, config);

    expect(ctx.streams.emit).toHaveBeenCalledWith(
      "notifications",
      expect.objectContaining({
        type: "assignment",
        issueId: "iss-1",
        issueTitle: "Fix login bug",
      }),
    );
  });

  it("emits mention notification when user is mentioned in description", async () => {
    const ctx = mockCtx();
    ctx.issues.get.mockResolvedValue({
      id: "iss-1",
      title: "Review needed",
      description: "Please ask sytze to review this PR.",
      assigneeUserId: "agent-1",
    });

    await handleIssueEvent(ctx as any, baseEvent as any, config);

    expect(ctx.streams.emit).toHaveBeenCalledWith(
      "notifications",
      expect.objectContaining({
        type: "mention",
        issueId: "iss-1",
      }),
    );
  });

  it("emits mention notification when user is mentioned in title", async () => {
    const ctx = mockCtx();
    ctx.issues.get.mockResolvedValue({
      id: "iss-1",
      title: "sytze: please check this",
      description: "No mention here.",
      assigneeUserId: "agent-1",
    });

    await handleIssueEvent(ctx as any, baseEvent as any, config);

    expect(ctx.streams.emit).toHaveBeenCalledWith(
      "notifications",
      expect.objectContaining({ type: "mention" }),
    );
  });

  it("skips when no match", async () => {
    const ctx = mockCtx();
    ctx.issues.get.mockResolvedValue({
      id: "iss-1",
      title: "Unrelated issue",
      description: "Nothing relevant.",
      assigneeUserId: "agent-1",
    });

    await handleIssueEvent(ctx as any, baseEvent as any, config);

    expect(ctx.streams.emit).not.toHaveBeenCalled();
  });

  it("skips duplicate events", async () => {
    const ctx = mockCtx();
    ctx.state.get.mockResolvedValue({ notifiedAt: new Date().toISOString() });
    ctx.issues.get.mockResolvedValue({
      id: "iss-1",
      title: "Fix login bug",
      description: "For sytze.",
      assigneeUserId: "user-1",
    });

    await handleIssueEvent(ctx as any, baseEvent as any, config);

    expect(ctx.streams.emit).not.toHaveBeenCalled();
  });

  it("logs warning and skips when issue fetch fails", async () => {
    const ctx = mockCtx();
    ctx.issues.get.mockRejectedValue(new Error("not found"));

    await handleIssueEvent(ctx as any, baseEvent as any, config);

    expect(ctx.logger.warn).toHaveBeenCalled();
    expect(ctx.streams.emit).not.toHaveBeenCalled();
  });

  it("handles issue.updated events the same as issue.created", async () => {
    const ctx = mockCtx();
    ctx.issues.get.mockResolvedValue({
      id: "iss-1",
      title: "Updated issue",
      description: "Now mentions sytze in the description.",
      assigneeUserId: "agent-1",
    });

    const updatedEvent = { ...baseEvent, eventType: "issue.updated" as const };
    await handleIssueEvent(ctx as any, updatedEvent as any, config);

    expect(ctx.streams.emit).toHaveBeenCalledWith(
      "notifications",
      expect.objectContaining({ type: "mention" }),
    );
  });

  it("prefers assignment over mention when both match", async () => {
    const ctx = mockCtx();
    ctx.issues.get.mockResolvedValue({
      id: "iss-1",
      title: "sytze fix this",
      description: "Assigned to sytze.",
      assigneeUserId: "user-1",
    });

    await handleIssueEvent(ctx as any, baseEvent as any, config);

    expect(ctx.streams.emit).toHaveBeenCalledWith(
      "notifications",
      expect.objectContaining({ type: "assignment" }),
    );
  });
});

describe("handleCommentEvent", () => {
  it("emits mention notification when user is mentioned in comment", async () => {
    const ctx = mockCtx();
    ctx.issues.get.mockResolvedValue({
      id: "iss-1",
      title: "Some issue",
      description: "Description",
      assigneeUserId: "agent-1",
    });
    ctx.issues.listComments.mockResolvedValue([
      { id: "cmt-1", body: "Hey @sytze can you look at this?" },
    ]);

    const event = {
      ...baseEvent,
      eventType: "issue.comment.created" as const,
      payload: { commentId: "cmt-1" },
    };

    await handleCommentEvent(ctx as any, event as any, config);

    expect(ctx.streams.emit).toHaveBeenCalledWith(
      "notifications",
      expect.objectContaining({
        type: "mention",
        issueId: "iss-1",
      }),
    );
  });

  it("skips when comment does not mention user", async () => {
    const ctx = mockCtx();
    ctx.issues.get.mockResolvedValue({
      id: "iss-1",
      title: "Some issue",
      description: "Description",
      assigneeUserId: "agent-1",
    });
    ctx.issues.listComments.mockResolvedValue([
      { id: "cmt-1", body: "Looks good to me." },
    ]);

    const event = {
      ...baseEvent,
      eventType: "issue.comment.created" as const,
      payload: { commentId: "cmt-1" },
    };

    await handleCommentEvent(ctx as any, event as any, config);

    expect(ctx.streams.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/worker.spec.ts`
Expected: FAIL — `handleIssueEvent` and `handleCommentEvent` not found

- [ ] **Step 3: Commit**

```bash
git add tests/worker.spec.ts
git commit -m "test: add worker event handler tests"
```

---

### Task 6: Worker — implementation

**Files:**
- Create: `src/worker.ts`

- [ ] **Step 1: Implement the worker**

```ts
import {
  definePlugin,
  runWorker,
  type PluginContext,
  type PluginEvent,
  type PluginHealthDiagnostics,
} from "@paperclipai/plugin-sdk";
import { STREAM_CHANNEL } from "./constants.js";
import type { NotificationPayload } from "./types.js";
import { matchesMention, extractExcerpt } from "./mention-matcher.js";

interface NotificationsConfig {
  userId: string;
  mentionIdentifiers: string;
}

interface ParsedConfig {
  userId: string;
  mentionIdentifiers: string[];
}

function parseConfig(raw: Record<string, unknown>): ParsedConfig {
  const cfg = raw as unknown as NotificationsConfig;
  const ids = (cfg.mentionIdentifiers || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  return { userId: cfg.userId || "", mentionIdentifiers: ids };
}

async function isDuplicate(
  ctx: PluginContext,
  eventId: string,
): Promise<boolean> {
  const existing = await ctx.state.get({
    scopeKind: "instance",
    stateKey: `notified-${eventId}`,
  });
  return existing !== null;
}

// Note: the read-modify-write on the index has a theoretical race condition
// if two events fire concurrently (last-write-wins). At expected notification
// volume this is acceptable — the worst case is a missed cleanup, not a missed
// notification.
async function markNotified(
  ctx: PluginContext,
  eventId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await ctx.state.set(
    { scopeKind: "instance", stateKey: `notified-${eventId}` },
    { notifiedAt: now },
  );
  // Update the dedup index for cleanup
  const index = (await ctx.state.get({
    scopeKind: "instance",
    stateKey: "notified-index",
  })) as Record<string, string> | null ?? {};
  index[eventId] = now;
  await ctx.state.set(
    { scopeKind: "instance", stateKey: "notified-index" },
    index,
  );
}

async function resolveCompanyPrefix(
  ctx: PluginContext,
  companyId: string,
): Promise<string> {
  const company = await ctx.companies.get(companyId);
  return company?.prefix ?? companyId;
}

export async function handleIssueEvent(
  ctx: PluginContext,
  event: PluginEvent,
  config: ParsedConfig,
): Promise<void> {
  if (await isDuplicate(ctx, event.eventId)) return;

  let issue;
  try {
    issue = await ctx.issues.get(event.entityId!, event.companyId);
  } catch (err) {
    ctx.logger.warn("Failed to fetch issue for notification", {
      issueId: event.entityId,
      error: String(err),
    });
    return;
  }
  if (!issue) return;

  const isAssigned =
    config.userId && (issue as any).assigneeUserId === config.userId;
  const textToSearch = `${issue.title} ${issue.description || ""}`;
  const isMentioned = matchesMention(textToSearch, config.mentionIdentifiers);

  if (!isAssigned && !isMentioned) return;

  const companyPrefix = await resolveCompanyPrefix(ctx, event.companyId);

  const payload: NotificationPayload = {
    type: isAssigned ? "assignment" : "mention",
    issueId: issue.id,
    issueTitle: issue.title,
    url: `/${companyPrefix}/issues/${issue.id}`,
    excerpt: isAssigned
      ? (issue.description || "").slice(0, 100)
      : extractExcerpt(textToSearch, config.mentionIdentifiers),
    occurredAt: event.occurredAt,
  };

  ctx.streams.emit(STREAM_CHANNEL, payload);
  await markNotified(ctx, event.eventId);
  ctx.logger.info("Notification sent", {
    type: payload.type,
    issueId: issue.id,
  });
}

export async function handleCommentEvent(
  ctx: PluginContext,
  event: PluginEvent,
  config: ParsedConfig,
): Promise<void> {
  if (await isDuplicate(ctx, event.eventId)) return;

  let issue;
  try {
    issue = await ctx.issues.get(event.entityId!, event.companyId);
  } catch (err) {
    ctx.logger.warn("Failed to fetch issue for comment notification", {
      issueId: event.entityId,
      error: String(err),
    });
    return;
  }
  if (!issue) return;

  let comments;
  try {
    comments = await ctx.issues.listComments(issue.id, event.companyId);
  } catch (err) {
    ctx.logger.warn("Failed to fetch comments", {
      issueId: issue.id,
      error: String(err),
    });
    return;
  }

  const commentId = (event.payload as any)?.commentId;
  const comment = comments.find((c: any) => c.id === commentId);
  if (!comment) return;

  const isMentioned = matchesMention(
    comment.body,
    config.mentionIdentifiers,
  );
  if (!isMentioned) return;

  const companyPrefix = await resolveCompanyPrefix(ctx, event.companyId);

  const payload: NotificationPayload = {
    type: "mention",
    issueId: issue.id,
    issueTitle: issue.title,
    url: `/${companyPrefix}/issues/${issue.id}`,
    excerpt: extractExcerpt(comment.body, config.mentionIdentifiers),
    occurredAt: event.occurredAt,
  };

  ctx.streams.emit(STREAM_CHANNEL, payload);
  await markNotified(ctx, event.eventId);
  ctx.logger.info("Comment notification sent", {
    type: payload.type,
    issueId: issue.id,
    commentId,
  });
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    const rawConfig = await ctx.config.get();
    const config = parseConfig(rawConfig);

    // Open notification streams for all companies
    const companies = await ctx.companies.list();
    for (const company of companies) {
      ctx.streams.open(STREAM_CHANNEL, company.id);
    }

    // Subscribe to issue events
    ctx.events.on("issue.created", async (event) => {
      await handleIssueEvent(ctx, event, config);
    });

    ctx.events.on("issue.updated", async (event) => {
      await handleIssueEvent(ctx, event, config);
    });

    ctx.events.on("issue.comment.created", async (event) => {
      await handleCommentEvent(ctx, event, config);
    });

    ctx.logger.info("Notifications plugin started", {
      userId: config.userId,
      identifiers: config.mentionIdentifiers,
    });
  },

  async onHealth(): Promise<PluginHealthDiagnostics> {
    return { status: "ok" };
  },
});

runWorker(plugin, import.meta.url);
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/worker.spec.ts`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/worker.ts
git commit -m "feat: implement worker with event handlers, dedup, and stream emission"
```

---

## Chunk 3: UI Components & Service Worker

### Task 7: Styles

**Files:**
- Create: `src/ui/styles.ts`

- [ ] **Step 1: Create shared styles**

```ts
export const s = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px",
    padding: "24px",
    maxWidth: "600px",
  },
  heading: {
    fontSize: "18px",
    fontWeight: "600" as const,
    margin: 0,
  },
  label: {
    fontSize: "14px",
    fontWeight: "500" as const,
    marginBottom: "4px",
    display: "block" as const,
  },
  input: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid var(--border, #333)",
    background: "var(--input, transparent)",
    color: "var(--foreground, #fff)",
    fontSize: "14px",
    boxSizing: "border-box" as const,
  },
  hint: {
    fontSize: "12px",
    color: "var(--muted-foreground, #888)",
    marginTop: "2px",
  },
  section: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    padding: "16px",
    borderRadius: "12px",
    border: "1px solid var(--border, #333)",
    background: "var(--card, #1a1a1a)",
  },
  btn: {
    padding: "8px 16px",
    borderRadius: "8px",
    border: "none",
    background: "var(--primary, #6366f1)",
    color: "#fff",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "500" as const,
  },
  statusGranted: {
    color: "var(--success, #22c55e)",
    fontSize: "14px",
  },
  statusDenied: {
    color: "var(--destructive, #ef4444)",
    fontSize: "14px",
  },
  statusDefault: {
    color: "var(--muted-foreground, #888)",
    fontSize: "14px",
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/styles.ts
git commit -m "feat: add shared UI styles"
```

---

### Task 8: Settings page

**Files:**
- Create: `src/ui/settings-page.tsx`

- [ ] **Step 1: Implement settings page**

```tsx
import { useState, useEffect } from "react";
import {
  usePluginData,
  usePluginAction,
  useHostContext,
  usePluginToast,
} from "@paperclipai/plugin-sdk/ui";
import type { PluginSettingsPageProps } from "@paperclipai/plugin-sdk/ui";
import { s } from "./styles.js";

export function SettingsPage(_props: PluginSettingsPageProps) {
  const hostCtx = useHostContext();
  const toast = usePluginToast();
  const { data: currentConfig } = usePluginData<{
    userId: string;
    mentionIdentifiers: string;
  }>("getConfig");
  const saveConfig = usePluginAction("saveConfig");

  const [userId, setUserId] = useState("");
  const [mentionIds, setMentionIds] = useState("");
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (currentConfig) {
      setUserId(currentConfig.userId || "");
      setMentionIds(currentConfig.mentionIdentifiers || "");
    }
  }, [currentConfig]);

  useEffect(() => {
    if ("Notification" in window) {
      setPermissionStatus(Notification.permission);
    }
  }, []);

  const handleSave = async () => {
    try {
      await saveConfig({ userId, mentionIdentifiers: mentionIds });
      toast("Configuration saved", "success");
    } catch {
      toast("Failed to save configuration", "error");
    }
  };

  const handleRequestPermission = async () => {
    if (!("Notification" in window)) {
      toast("Notifications not supported in this browser", "error");
      return;
    }
    const result = await Notification.requestPermission();
    setPermissionStatus(result);
    if (result === "granted") {
      toast("Notification permission granted", "success");
    } else {
      toast("Notification permission denied", "error");
    }
  };

  const permissionStyle =
    permissionStatus === "granted"
      ? s.statusGranted
      : permissionStatus === "denied"
        ? s.statusDenied
        : s.statusDefault;

  return (
    <div style={s.container}>
      <h2 style={s.heading}>Notification Settings</h2>

      <div style={s.section}>
        <label style={s.label}>User ID</label>
        <input
          style={s.input}
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="Your Paperclip user ID"
        />
        <span style={s.hint}>Used to detect when issues are assigned to you.</span>
      </div>

      <div style={s.section}>
        <label style={s.label}>Mention Identifiers</label>
        <input
          style={s.input}
          type="text"
          value={mentionIds}
          onChange={(e) => setMentionIds(e.target.value)}
          placeholder="sytze, @sytze"
        />
        <span style={s.hint}>
          Comma-separated list of names to match. Each must be at least 3 characters.
        </span>
      </div>

      <button style={s.btn} onClick={handleSave}>
        Save
      </button>

      <div style={s.section}>
        <label style={s.label}>Browser Notifications</label>
        <span style={permissionStyle}>
          Status: {permissionStatus}
        </span>
        {permissionStatus !== "granted" && (
          <button style={s.btn} onClick={handleRequestPermission}>
            Enable Notifications
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/settings-page.tsx
git commit -m "feat: add settings page for user ID, mention IDs, and permission"
```

---

### Task 9: Service Worker

**Files:**
- Create: `src/ui/sw.ts`

- [ ] **Step 1: Implement the Service Worker**

```ts
/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

// NotificationPayload is defined in src/types.ts but we inline the shape here
// because the SW runs in an isolated scope and cannot import from the main bundle.
interface NotificationPayload {
  type: "assignment" | "mention";
  issueId: string;
  issueTitle: string;
  url: string;
  excerpt: string;
  occurredAt: string;
}

// Take control immediately on install
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Receive notification payloads from the relay component
self.addEventListener("message", (event) => {
  const data = event.data as NotificationPayload | undefined;
  if (!data || !data.issueId) return;

  const title =
    data.type === "assignment"
      ? `Assigned: ${data.issueTitle}`
      : `Mentioned: ${data.issueTitle}`;

  self.registration.showNotification(title, {
    body: data.excerpt,
    tag: `notification-${data.issueId}-${data.occurredAt}`,
    data: { url: data.url },
  });
});

// Handle notification click — navigate to the issue
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification.data as { url: string })?.url;
  if (!url) return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: false })
      .then((windowClients) => {
        // Try to find an existing Paperclip tab
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin)) {
            client.navigate(url);
            client.focus();
            return;
          }
        }
        // No existing tab — open a new one
        return self.clients.openWindow(url);
      }),
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/sw.ts
git commit -m "feat: add service worker for OS notifications and click navigation"
```

---

### Task 10: Notification relay component

**Files:**
- Create: `src/ui/notification-relay.tsx`

- [ ] **Step 1: Implement the relay**

```tsx
import { useEffect, useRef } from "react";
import { usePluginStream } from "@paperclipai/plugin-sdk/ui";
import { STREAM_CHANNEL } from "../constants.js";
import type { NotificationPayload } from "../types.js";

/**
 * Invisible globalToolbarButton component that:
 * 1. Registers the Service Worker
 * 2. Subscribes to the notification stream
 * 3. Relays events to the Service Worker via postMessage
 *
 * The SW file is served by the plugin host from the plugin's dist/ui/ directory.
 * The exact URL depends on how the host maps plugin assets. We use a relative
 * path that the host should resolve to the plugin's UI asset directory.
 */
export function NotificationRelay() {
  const { lastEvent } = usePluginStream<NotificationPayload>(STREAM_CHANNEL);
  const swReady = useRef(false);

  // Register Service Worker on mount
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      console.warn("[notifications] Service Workers not supported");
      return;
    }

    // The SW file lives in the plugin's UI dist directory.
    // The host serves plugin UI assets at a known path; we register relative
    // to the current page origin. If the host does not serve the SW at root,
    // adjust this path to match the host's plugin asset serving convention.
    navigator.serviceWorker
      .register("/api/plugins/notifications/ui/sw-notifications.js", { scope: "/" })
      .then(() => {
        swReady.current = true;
      })
      .catch((err) => {
        console.warn("[notifications] SW registration failed:", err);
      });
  }, []);

  // Relay stream events to Service Worker
  useEffect(() => {
    if (!lastEvent) return;
    if (Notification.permission !== "granted") return;

    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(lastEvent);
    }
  }, [lastEvent]);

  // Invisible — this component renders nothing
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/notification-relay.tsx
git commit -m "feat: add notification relay component (globalToolbarButton)"
```

---

## Chunk 4: Build Tooling & Final Wiring

### Task 11: Build scripts

**Files:**
- Create: `scripts/build-ui.mjs`

- [ ] **Step 1: Create the UI build script**

This builds two separate bundles: the main UI (settings page + relay) and the Service Worker.

```js
import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

// Build main UI bundle (settings page + notification relay)
await esbuild.build({
  entryPoints: [path.join(packageRoot, "src/ui/index.tsx")],
  outfile: path.join(packageRoot, "dist/ui/index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@paperclipai/plugin-sdk/ui",
  ],
  logLevel: "info",
});

// Build Service Worker as a separate self-contained bundle
await esbuild.build({
  entryPoints: [path.join(packageRoot, "src/ui/sw.ts")],
  outfile: path.join(packageRoot, "dist/ui/sw-notifications.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  logLevel: "info",
});
```

- [ ] **Step 2: Create `src/ui/index.tsx` — UI entry point**

```tsx
export { SettingsPage } from "./settings-page.js";
export { NotificationRelay } from "./notification-relay.js";
```

- [ ] **Step 3: Commit**

```bash
git add scripts/build-ui.mjs src/ui/index.tsx
git commit -m "feat: add esbuild scripts for UI bundle and Service Worker"
```

---

### Task 12: Worker data/action handlers for settings page

The settings page uses `usePluginData("getConfig")` and `usePluginAction("saveConfig")`. These need to be registered in the worker.

**Files:**
- Modify: `src/worker.ts` — add `getConfig` and `saveConfig` handlers inside `setup()`

- [ ] **Step 1: Add data and action handlers to the worker**

Add these registrations inside the `setup()` function, after `const config = parseConfig(rawConfig);`:

```ts
    // Data: return current config for settings page
    ctx.data.register("getConfig", async () => {
      return await ctx.config.get();
    });

    // Action: save config (updates are handled by the host)
    ctx.actions.register("saveConfig", async (params) => {
      // The host persists config changes via the instanceConfigSchema.
      // This action triggers a config reload.
      const newRaw = params as Record<string, unknown>;
      config.userId = String(newRaw.userId || "");
      config.mentionIdentifiers = (String(newRaw.mentionIdentifiers || ""))
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length >= 3);
      ctx.logger.info("Config updated", {
        userId: config.userId,
        identifiers: config.mentionIdentifiers,
      });
      return { success: true };
    });
```

Note: `config` must be changed from `const` to `let` so it can be reassigned in the action handler. Actually, since we're mutating the object fields, `const` is fine — we're modifying properties, not reassigning.

- [ ] **Step 2: Run worker tests to make sure nothing broke**

Run: `npx vitest run tests/worker.spec.ts`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/worker.ts
git commit -m "feat: add getConfig data handler and saveConfig action to worker"
```

---

### Task 13: Deduplication cleanup

The spec requires a cleanup pass on startup and every 24 hours. The `markNotified` function (in Task 6) already maintains the dedup index. This task adds the cleanup function and wires it into `setup()`.

**Files:**
- Modify: `src/worker.ts`

- [ ] **Step 1: Add cleanup logic to the worker**

Add these constants and function before the `handleIssueEvent` function:

```ts
const DEDUP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function cleanupDedupState(ctx: PluginContext): Promise<void> {
  const index = (await ctx.state.get({
    scopeKind: "instance",
    stateKey: "notified-index",
  })) as Record<string, string> | null;

  if (!index) return;

  const now = Date.now();
  const surviving: Record<string, string> = {};

  for (const [eventId, notifiedAt] of Object.entries(index)) {
    if (now - new Date(notifiedAt).getTime() < DEDUP_TTL_MS) {
      surviving[eventId] = notifiedAt;
    } else {
      await ctx.state.delete({
        scopeKind: "instance",
        stateKey: `notified-${eventId}`,
      });
    }
  }

  await ctx.state.set(
    { scopeKind: "instance", stateKey: "notified-index" },
    surviving,
  );

  ctx.logger.info("Dedup cleanup complete", {
    removed: Object.keys(index).length - Object.keys(surviving).length,
    remaining: Object.keys(surviving).length,
  });
}
```

Add to `setup()`, after opening streams:

```ts
    // Run cleanup on startup and every 24 hours
    await cleanupDedupState(ctx);
    setInterval(() => cleanupDedupState(ctx), CLEANUP_INTERVAL_MS);
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/worker.ts
git commit -m "feat: add deduplication state cleanup with 7-day TTL"
```

---

### Task 14: Typecheck and build

**Files:** All existing files

- [ ] **Step 1: Install dependencies**

Run: `pnpm install` (or `npm install` if outside the Paperclip monorepo)

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: all tests PASS

- [ ] **Step 4: Run build**

Run: `pnpm build`
Expected: `dist/` directory created with `worker.js`, `manifest.js`, `ui/index.js`, `ui/sw-notifications.js`

- [ ] **Step 5: Commit any fixes needed, then final commit**

```bash
git add -A
git commit -m "chore: verify typecheck, tests, and build pass"
```

---

### Task 15: Installation test

- [ ] **Step 1: Install the plugin into your Paperclip instance**

```bash
curl -X POST http://<your-vps>:3100/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"packageName": "/absolute/path/to/paperclip-notifications", "isLocalPath": true}'
```

- [ ] **Step 2: Open Paperclip in Brave, navigate to the Notifications settings page**

- Verify the settings form renders
- Configure your user ID and mention identifiers
- Grant notification permission

- [ ] **Step 3: Create a test issue that mentions your identifier**

- Verify an OS notification appears
- Click the notification — verify it navigates to the issue

- [ ] **Step 4: Create a test issue assigned to your user ID**

- Verify an assignment notification appears
- Click the notification — verify navigation works
