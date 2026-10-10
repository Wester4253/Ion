import { describe, expect, test } from "vitest";

import { IPC, isIonChannel } from "./ipc";

describe("IPC channel allowlist", () => {
  test("every declared channel is allowed", () => {
    for (const channel of Object.values(IPC)) {
      expect(isIonChannel(channel)).toBe(true);
    }
  });

  test("unknown and hostile channel names are refused", () => {
    const refused = [
      "",
      "ion:",
      "ion:fs:read ",
      "ION:FS:READ",
      "electron/BrowserWindow",
      "ipcMain",
      "ion:fs:read/../settings",
      "ion:evil",
    ];
    for (const channel of refused) {
      expect(isIonChannel(channel)).toBe(false);
    }
  });

  test("channels are namespaced under ion:", () => {
    for (const channel of Object.values(IPC)) {
      expect(channel.startsWith("ion:")).toBe(true);
    }
  });
});
