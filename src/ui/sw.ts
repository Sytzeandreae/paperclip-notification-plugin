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
