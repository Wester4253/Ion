/**
 * Main window creation and lifecycle: bounds persistence, close-to-tray,
 * navigation policy, and link handling.
 */

import { app, BrowserWindow, nativeImage, screen, shell } from "electron";
import { join } from "node:path";

import { DEFAULT_HEIGHT, DEFAULT_WIDTH, DISCORD_APP_URL, MIN_HEIGHT, MIN_WIDTH } from "./constants";
import { isAllowedExternalUrl, isAllowedNavigation } from "./navigation";
import {
  loadWindowState,
  windowStatePath,
  WindowStateWriter,
  type ShellSettingsStore,
} from "./store";
import { initTray } from "./tray";
import type { Rect } from "./windowState";

const BOUNDS_SAVE_DELAY_MS = 400;

interface WindowOptions {
  readonly settings: ShellSettingsStore;
  /** Called when the user chooses Quit from the tray (bypasses close-to-tray). */
  readonly requestQuit: () => void;
  /** Start with the window unmapped (smoke runs); it still renders offscreen. */
  readonly hidden?: boolean;
  /**
   * Runs after the window exists but before the first navigation commits,
   * so smoke capture is attached (and its debugger domains enabled) before
   * the page can log anything at boot.
   */
  readonly beforeLoad?: ((win: BrowserWindow) => void | Promise<void>) | undefined;
}

export async function createMainWindow(options: WindowOptions): Promise<BrowserWindow> {
  const { settings, requestQuit, hidden } = options;
  const displays = screen.getAllDisplays().map((display) => ({ bounds: display.bounds }));
  const state = loadWindowState(windowStatePath(), displays);

  const win = new BrowserWindow({
    width: state.bounds?.width ?? DEFAULT_WIDTH,
    height: state.bounds?.height ?? DEFAULT_HEIGHT,
    ...(state.bounds ? { x: state.bounds.x, y: state.bounds.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: !hidden,
    backgroundColor: "#313338",
    // Hide the File/Edit/View menu bar; Alt still reveals it.
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(join(__dirname, "..", "assets", "icon.png")),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      // Keep Discord's voice connection and animations alive in the background.
      backgroundThrottling: false,
      // Smoke runs never map a window; render offscreen so frames still
      // commit and screenshots reflect the current DOM.
      ...(hidden ? { offscreen: true } : {}),
    },
  });

  attachStatePersistence(win, new WindowStateWriter(windowStatePath()), requestQuit, settings);
  applyNavigationPolicy(win);
  // Calls stuck at "DTLS Connecting" are commonly caused by the wrong IP
  // handling policy behind VPNs; the setting is exposed so users can change it.
  win.webContents.setWebRTCIPHandlingPolicy(settings.data.webRTCIPHandlingPolicy);
  await options.beforeLoad?.(win);
  void win.loadURL(DISCORD_APP_URL);
  return win;
}

function attachStatePersistence(
  win: BrowserWindow,
  writer: WindowStateWriter,
  requestQuit: () => void,
  settings: ShellSettingsStore,
): void {
  let isQuitting = false;
  let boundsTimer: NodeJS.Timeout | null = null;

  const persistBounds = () => {
    if (win.isDestroyed() || win.isMaximized() || win.isMinimized()) return;
    writer.write(win.getBounds(), false);
  };
  const schedulePersistBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      boundsTimer = null;
      persistBounds();
    }, BOUNDS_SAVE_DELAY_MS);
  };
  const persistMaximized = () => {
    const bounds: Rect | null = win.isMaximized() || win.isMinimized() ? null : win.getBounds();
    writer.write(bounds, win.isMaximized());
  };

  app.on("before-quit", () => {
    isQuitting = true;
  });

  win.on("resize", schedulePersistBounds);
  win.on("move", schedulePersistBounds);
  win.on("restore", schedulePersistBounds);
  win.on("maximize", persistMaximized);
  win.on("unmaximize", persistMaximized);

  win.on("close", (event) => {
    if (boundsTimer) {
      clearTimeout(boundsTimer);
      boundsTimer = null;
      persistBounds();
    }
    if (isQuitting || !settings.data.closeToTray || !settings.data.trayEnabled) return;
    event.preventDefault();
    win.hide();
  });

  if (settings.data.trayEnabled) initTray(win, requestQuit);
}

function applyNavigationPolicy(win: BrowserWindow): void {
  const { webContents } = win;
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
}
