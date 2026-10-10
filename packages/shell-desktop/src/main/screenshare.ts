/**
 * Screen-share support.
 *
 * On Linux, `setDisplayMediaRequestHandler` receives the `getDisplayMedia()`
 * request from Discord and must resolve it with a DesktopCapturerSource.
 * Under Wayland, capture goes through the xdg-desktop-portal PipeWire
 * handshake; if the user cancels that portal dialog, `getSources` rejects and
 * we deny the request.
 *
 * Audio: Electron only supports `loopback` system audio capture on Windows.
 * On Linux there is no supported loopback stream here, so video-only streams
 * are granted and Discord's "share audio" option stays unavailable. See
 * docs/linux.md for details and workarounds.
 */

import { desktopCapturer, session } from "electron";

type DisplayMediaHandler = NonNullable<
  Parameters<typeof session.defaultSession.setDisplayMediaRequestHandler>[0]
>;

async function resolveDisplayMedia(
  request: Parameters<DisplayMediaHandler>[0],
  callback: Parameters<DisplayMediaHandler>[1],
): Promise<void> {
  if (!request.videoRequested) {
    callback(null);
    return;
  }
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      // No picker UI exists yet, so only a small thumbnail is needed.
      thumbnailSize: { width: 160, height: 90 },
    });
    const screen = sources.find((source) => source.id.startsWith("screen:")) ?? sources[0];
    if (!screen) {
      callback(null);
      return;
    }
    callback({ video: screen });
  } catch (error) {
    // The PipeWire portal was cancelled or failed: deny, do not crash.
    console.warn("[ion] screen capture cancelled or failed:", error);
    callback(null);
  }
}

export function registerScreenShareHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    void resolveDisplayMedia(request, callback);
  });
}
