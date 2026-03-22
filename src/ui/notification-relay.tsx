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
