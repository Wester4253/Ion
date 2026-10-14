/**
 * Ion desktop shell entry point.
 *
 * Order matters: Chromium switches must be planned and applied before
 * `app.ready`, so settings are loaded synchronously at module scope.
 */

import { app, session } from "electron";
import type { BrowserWindow } from "electron";

import { registerCspHandler } from "./csp";
import { buildChromiumSwitchPlan } from "./flags";
import { parseSeedVencordSettingsArg, parseSmokeSettleArg } from "./harnessFlags";
import { registerIpcHandlers } from "./ipc";
import { registerPermissionHandlers } from "./permissions";
import { registerScreenShareHandler } from "./screenshare";
import { parseProfileArg } from "./profile";
import { attachSmokeCapture, parseSmokeArg, runSmoke } from "./smoke";
import { ShellSettingsStore, shellSettingsPath } from "./store";
import { createMainWindow } from "./window";

// Must happen before any getPath() call so settings land in ~/.config/Ion.
app.setName("Ion");

// Isolated-profile override: must precede every getPath() read so the run's
// Chromium data, single-instance lock, and Ion settings all move with it.
const profileDir = parseProfileArg(process.argv);
if (profileDir !== null) app.setPath("userData", profileDir);

const settings = new ShellSettingsStore(shellSettingsPath());

const plan = buildChromiumSwitchPlan(settings.data, process.platform, process.argv);
if (plan.disableHardwareAcceleration) app.disableHardwareAcceleration();
for (const [name, value] of plan.switches) app.commandLine.appendSwitch(name, value);

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  let mainWin: BrowserWindow | null = null;

  app.on("second-instance", () => {
    if (!mainWin) return;
    if (mainWin.isMinimized()) mainWin.restore();
    if (!mainWin.isVisible()) mainWin.show();
    mainWin.focus();
  });

  void app.whenReady().then(async () => {
    registerPermissionHandlers();
    registerScreenShareHandler();
    // Grants the vencord.dev hosts the bundled plugins call; see csp.ts.
    registerCspHandler(session.defaultSession);
    // Before the window: the preload synchronously fetches the core bundle.
    registerIpcHandlers({
      settings,
      harnessSeed: parseSeedVencordSettingsArg(process.argv),
    });

    const smokeDir = parseSmokeArg(process.argv);
    mainWin = await createMainWindow({
      settings,
      requestQuit: () => {
        app.quit();
      },
      // Smoke runs never flash a window; it renders offscreen either way.
      hidden: smokeDir !== null,
      // Capture attaches before the first navigation commits, so nothing
      // the page logs at boot is lost to a debugger-enable race. Reporting
      // only touches the page after load, so arming it here is safe.
      beforeLoad:
        smokeDir === null
          ? undefined
          : (win) => {
              runSmoke(smokeDir, win, attachSmokeCapture(win), {
                settleMs: parseSmokeSettleArg(process.argv) ?? undefined,
              });
            },
    });

    mainWin.on("closed", () => {
      mainWin = null;
    });
  });

  app.on("window-all-closed", () => {
    // No macOS target; when every window is gone (close-to-tray disabled),
    // there is nothing left to show.
    app.quit();
  });
}
