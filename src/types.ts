export interface NotificationPayload {
  type: "assignment" | "mention";
  issueId: string;
  issueTitle: string;
  url: string;
  excerpt: string;
  occurredAt: string;
}
