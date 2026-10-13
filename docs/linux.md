# Linux notes

Ion targets Linux first. This document records how the shell behaves on Wayland
and X11, which Chromium flags are exposed and why, and the current state of
screenshare audio.

## Wayland and X11

The shell sets `--ozone-platform-hint` from the `ozonePlatform` setting:

| Value     | Effect                                            |
| --------- | ------------------------------------------------- |
| `auto`    | Default. Native Wayland when available, else X11. |
| `x11`     | Force X11 (XWayland on Wayland sessions).         |
| `wayland` | Force native Wayland.                             |

On NVIDIA + Wayland you may see this at startup:

```
ERROR:ui/ozone/platform/wayland/gpu/wayland_surface_factory.cc:249]
'--ozone-platform=wayland' is not compatible with Vulkan.
```

It is benign: Chromium falls back to OpenGL and rendering is unaffected. If you
want to silence it or suspect GPU trouble, add `disable-vulkan` to
`extraChromiumFlags`, or set `ozonePlatform` to `x11`.

Known Wayland platform facts (Chromium limitations, not Ion bugs):

- Windows cannot be repositioned programmatically, so saved window positions
  are honored only as far as the compositor allows.
- Global shortcuts and tray icons depend on the compositor.

## Tray

The tray icon uses the standard status-notifier protocol.

- **KDE Plasma, Cinnamon, MATE, XFCE:** works out of the box.
- **GNOME:** requires the AppIndicator extension
  (`gnome-shell-extension-appindicator`). Without it the tray icon is hidden
  and close-to-tray would be unreachable — if Ion detects no tray, closing the
  window quits the app instead of hiding it.

## Settings

Shell settings live at `~/.config/Ion/ion/shell.json` and are read at startup
(`closeToTray` applies immediately). Example:

```json
{
  "closeToTray": true,
  "trayEnabled": true,
  "hardwareAcceleration": true,
  "ozonePlatform": "auto",
  "gpuMode": "auto",
  "webRTCIPHandlingPolicy": "default",
  "extraChromiumFlags": []
}
```

| Setting                  | Purpose                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `closeToTray`            | `true`: closing the window hides to tray (default). `false`: quits.                                  |
| `trayEnabled`            | Show the tray icon.                                                                                  |
| `hardwareAcceleration`   | Set `false` to force software rendering.                                                             |
| `ozonePlatform`          | `auto`, `x11`, or `wayland`.                                                                         |
| `gpuMode`                | `disabled` turns the GPU off entirely (also: run with `--disable-gpu`).                              |
| `webRTCIPHandlingPolicy` | Voice calls stuck at "DTLS Connecting" (VPN/Tailscale): try `default_public_and_private_interfaces`. |
| `extraChromiumFlags`     | Raw Chromium switches, e.g. `["disable-vulkan"]`. Merged with Ion's.                                 |

`enable-features` and `disable-features` in `extraChromiumFlags` are merged
with Ion's own lists; every other user flag overrides Ion's value by name.

## GPU

- `gpuMode: "auto"` (default): Chromium picks; GPU blocklisting applies.
- `gpuMode: "disabled"`: `app.disableHardwareAcceleration()` before startup.
- Command-line escape hatch: `--disable-gpu`.

Hardware video acceleration is enabled through `AcceleratedVideoDecoder` /
`AcceleratedVideoEncoder` features.

## Screen share

Video screen share works on both Wayland and X11:

- **Wayland:** capture goes through the xdg-desktop-portal PipeWire handshake.
  Your desktop shows its native "share screen" permission dialog the first
  time; cancelling it denies the request cleanly.
- **X11:** sources come from `desktopCapturer` directly.

### Audio (honest status)

**Sharing system audio alongside the screen does not work on Linux.** Electron
only implements the `loopback` audio stream on Windows
(`session.setDisplayMediaRequestHandler`). There is no supported Linux
equivalent in Electron today, so Ion grants video-only streams and Discord's
"Share audio" option stays unavailable.

Options if you need others to hear your system audio:

1. **Wait for Electron/upstream work.** This is tracked for reassessment each
   Electron major upgrade; Ion will adopt it the moment it exists.
2. **Virtual microphone workaround:** create a PipeWire/PulseAudio null sink and
   loop your output into it (`pactl load-module module-null-sink` +
   `module-loopback`), then share that device as your _microphone_ in Discord
   while streaming. This consumes your mic input slot, so it is a workaround,
   not parity.

Voice chat, camera video, and normal streaming without audio all work normally.

## Installing

| Method                  | Command                                                    | Notes                                                                                                         |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **AUR (source)**        | `makepkg -si` in the package directory, or your AUR helper | Builds from git and installs the Arch layout. This is the package for Arch, CachyOS, Manjaro and EndeavourOS. |
| **Pacman (built here)** | `pacman -U packaging/ion-*.pkg.tar.zst`                    | Produced locally by `pnpm package:arch`; no build on your machine.                                            |
| **AppImage**            | `chmod +x Ion-*.AppImage && ./Ion-*.AppImage`              | Runs from anywhere; no integration with your theme or launcher.                                               |
| **Debian/Ubuntu**       | `sudo apt install ./Ion-*.deb`                             | Ships for completeness; the Debian layout is not the Arch one.                                                |

The AUR PKGBUILD lives in [`packaging/PKGBUILD`](../packaging/PKGBUILD) with its
install hooks, desktop entry and AppStream metadata, so an AUR submission is
that directory as-is. It depends on `pnpm` and `nodejs` from the repos, and sets
`options=(!strip)`: Electron's shipped binaries carry symbols they resolve at
runtime, so a stripped package fails to start.

To build everything locally:

```bash
pnpm build                     # every package's bundle
node scripts/collect-bundles.mjs   # → packages/shell-desktop/bundles/
pnpm package:arch              # → packaging/ion-<version>-x86_64.pkg.tar.zst
```

First run asks for login and stores its profile under `~/.config/Ion`, which
survives upgrades and removals.

### Screen casting, tray and notifications

PipeWire and the xdg-desktop-portal implementation your desktop ships are the
runtime requirements for screenshare; they are `optdepends` of the package, so
`pacman -Qi ion` tells you when one is missing. The tray uses the standard
status-notifier protocol, which GNOME needs the AppIndicator extension for.

## Windows

Windows is supported but **not verified here**: this project is developed and
tested on Linux, so nothing below has been run. The packaging configuration is
in place (`pnpm package:win` builds an NSIS installer and a portable
executable), and the checklist is for whoever first installs it on Windows.

- [ ] Install the NSIS installer; confirm `Ion.exe` appears in the Start menu
      with the right icon and that the app id `network.ion.client` groups the
      taskbar entry (set before any window is created).
- [ ] Sign in, and confirm the plugin host starts and the settings tab is
      reachable — the same three smoke probes Linux runs (`coreInjected`,
      `discoveryReady`, `debugPanelMounted`) should all be true, which the
      debug popover reports.
- [ ] Screenshare **with system audio**: this is the one place Electron supports
      the loopback stream, so it should work here even though it cannot on Linux.
      Share a screen with "Share audio" on and confirm the other side hears it.
- [ ] Screenshare without audio, and voice chat.
- [ ] Close-to-tray: closing the window must leave the app running, with the
      tray icon able to focus and quit it.
- [ ] Auto-update: the update check is built but **not wired to an endpoint**
      (see QUESTIONS.md Q7). Expect it to do nothing; confirm it also does not
      error the app.
- [ ] Uninstall through Windows' app list, and confirm the profile under
      `%APPDATA%/Ion` is left alone.
- [ ] Portable executable: run it from a USB path, confirm it writes its profile
      to `%APPDATA%` and not next to the executable.

Anything that fails on Windows gets recorded as a failure on the scoreboard,
not worked around.
