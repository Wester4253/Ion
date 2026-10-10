/** Tray icon: show, focus, quit. */

import { Menu, Tray, nativeImage } from "electron";
import type { BrowserWindow } from "electron";
import { join } from "node:path";

let tray: Tray | null = null;

function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

/**
 * Create the tray icon. If one already exists it is replaced, so this is safe
 * to call again after a settings change.
 */
export function initTray(win: BrowserWindow, requestQuit: () => void): void {
  destroyTray();

  const instance = new Tray(
    nativeImage.createFromPath(join(__dirname, "..", "assets", "icon.png")),
  );
  instance.setToolTip("Ion");
  instance.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open Ion",
        click: () => {
          showWindow(win);
        },
      },
      { type: "separator" },
      { label: "Quit", click: requestQuit },
    ]),
  );
  instance.on("click", () => {
    showWindow(win);
  });
  tray = instance;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
