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
      toast({ title: "Configuration saved", tone: "success" });
    } catch {
      toast({ title: "Failed to save configuration", tone: "error" });
    }
  };

  const handleRequestPermission = async () => {
    if (!("Notification" in window)) {
      toast({ title: "Notifications not supported in this browser", tone: "error" });
      return;
    }
    const result = await Notification.requestPermission();
    setPermissionStatus(result);
    if (result === "granted") {
      toast({ title: "Notification permission granted", tone: "success" });
    } else {
      toast({ title: "Notification permission denied", tone: "error" });
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
