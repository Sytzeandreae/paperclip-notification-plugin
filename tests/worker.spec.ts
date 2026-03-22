import { describe, it, expect, vi } from "vitest";
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
      expect.objectContaining({ type: "mention", issueId: "iss-1" }),
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
    expect(ctx.issues.get).not.toHaveBeenCalled();
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
      expect.objectContaining({ type: "mention", issueId: "iss-1" }),
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

  it("skips duplicate comment events", async () => {
    const ctx = mockCtx();
    ctx.state.get.mockResolvedValue({ notifiedAt: new Date().toISOString() });
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
    expect(ctx.streams.emit).not.toHaveBeenCalled();
    expect(ctx.issues.get).not.toHaveBeenCalled();
  });

  it("logs warning and skips when issue fetch fails for comment event", async () => {
    const ctx = mockCtx();
    ctx.issues.get.mockRejectedValue(new Error("network error"));
    const event = {
      ...baseEvent,
      eventType: "issue.comment.created" as const,
      payload: { commentId: "cmt-1" },
    };
    await handleCommentEvent(ctx as any, event as any, config);
    expect(ctx.logger.warn).toHaveBeenCalled();
    expect(ctx.streams.emit).not.toHaveBeenCalled();
  });
});
