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
