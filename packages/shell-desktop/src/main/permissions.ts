/**
 * Permission policy for the Discord session.
 *
 * Discord is the only document allowed in the window (see `navigation.ts`), so
 * media, screen capture, notifications, clipboard, and fullscreen are granted
 * unconditionally. Everything else is denied: there is no legitimate reason for
 * a Discord document to request geolocation, HID, serial, or USB access.
 */

import { session } from "electron";

const GRANTED_PERMISSIONS = new Set([
  "media",
  "display-capture",
  "fullscreen",
  "notifications",
  "clipboard-read",
  "clipboard-sanitized-write",
  "local-fonts",
  "storage-access",
  "persistent-storage",
  "screen-wake-lock",
  "speaker-selection",
]);

export function registerPermissionHandlers(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(GRANTED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_webContents, permission) => GRANTED_PERMISSIONS.has(permission));
}
