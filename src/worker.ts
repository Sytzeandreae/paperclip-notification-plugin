import { STREAM_CHANNEL } from "./constants.js";
import type { NotificationPayload } from "./types.js";
import { matchesMention, extractExcerpt } from "./mention-matcher.js";

// These types are from @paperclipai/plugin-sdk but we define minimal
// versions here so the module can be tested without the SDK installed.
// The full types will be used when the SDK is available.
type PluginContext = any;
type PluginEvent = any;
interface NotificationsConfig {
  userId: string;
  mentionIdentifiers: string;
}

export interface ParsedConfig {
  userId: string;
  mentionIdentifiers: string[];
}

export function parseConfig(raw: Record<string, unknown>): ParsedConfig {
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
  if (!commentId) {
    ctx.logger.warn("Comment event missing commentId", { eventId: event.eventId });
    return;
  }
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

// ---------------------------------------------------------------------------
// Deduplication cleanup
// ---------------------------------------------------------------------------

const DEDUP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function cleanupDedupState(ctx: any): Promise<void> {
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

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

async function setupPlugin(ctx: any): Promise<void> {
  // Load config: prefer plugin state (user-saved), fall back to host config
  const savedConfig = await ctx.state.get({
    scopeKind: "instance",
    stateKey: "plugin-config",
  }) as Record<string, unknown> | null;
  const rawConfig = savedConfig ?? await ctx.config.get();
  const config = parseConfig(rawConfig);

  // Open notification streams for all companies
  const companies = await ctx.companies.list();
  for (const company of companies) {
    ctx.streams.open(STREAM_CHANNEL, company.id);
  }

  // Run cleanup on startup and every 24 hours
  await cleanupDedupState(ctx);
  setInterval(() => cleanupDedupState(ctx), CLEANUP_INTERVAL_MS);

  // Data: return current config for settings page
  ctx.data.register("getConfig", async () => {
    const saved = await ctx.state.get({
      scopeKind: "instance",
      stateKey: "plugin-config",
    }) as Record<string, unknown> | null;
    return saved ?? await ctx.config.get();
  });

  // Action: save config — persists to plugin state and updates in-memory config.
  ctx.actions.register("saveConfig", async (params: Record<string, unknown>) => {
    const newConfig = {
      userId: String(params.userId || ""),
      mentionIdentifiers: String(params.mentionIdentifiers || ""),
    };
    await ctx.state.set(
      { scopeKind: "instance", stateKey: "plugin-config" },
      newConfig,
    );
    const parsed = parseConfig(newConfig);
    config.userId = parsed.userId;
    config.mentionIdentifiers = parsed.mentionIdentifiers;
    ctx.logger.info("Config saved", {
      userId: config.userId,
      identifiers: config.mentionIdentifiers,
    });
    return { success: true };
  });

  // Subscribe to issue events
  ctx.events.on("issue.created", async (event: any) => {
    await handleIssueEvent(ctx, event, config);
  });

  ctx.events.on("issue.updated", async (event: any) => {
    await handleIssueEvent(ctx, event, config);
  });

  ctx.events.on("issue.comment.created", async (event: any) => {
    await handleCommentEvent(ctx, event, config);
  });

  ctx.logger.info("Notifications plugin started", {
    userId: config.userId,
    identifiers: config.mentionIdentifiers,
  });
}

// Only run when executed directly (not when imported for testing)
if (typeof process !== "undefined" && process.env?.VITEST === undefined) {
  // Dynamic import to avoid test failures when SDK is not installed
  import("@paperclipai/plugin-sdk").then(({ definePlugin, runWorker }) => {
    const plugin = definePlugin({
      async setup(ctx: any) {
        await setupPlugin(ctx);
      },
      async onHealth() {
        return { status: "ok" };
      },
    });
    runWorker(plugin, import.meta.url);
  });
}
