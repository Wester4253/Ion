/**
 * Ion desktop preload.
 *
 * Runs in a sandboxed, context-isolated world before any page script. Phase 1
 * only proves the bridge is alive; the typed IPC surface and the core bundle
 * injection land in Phase 2.
 */

import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("ionShell", {
  electronVersion: process.versions.electron,
});
