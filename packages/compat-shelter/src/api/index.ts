/**
 * Building `window.shelter` — the whole API a Shelter plugin sees.
 *
 * The shape mirrors upstream's `src/windowApi.ts` member for member (CC0-1.0,
 * see THIRD_PARTY.md): the same names, in the same nesting, including the
 * `without(...)` exclusions — `shelter.patcher` has no `unpatchAll`, and the
 * flux surface drops its internal discovery helpers. A plugin should not be
 * able to tell which of the two it is running under from the API alone.
 *
 * The build is async because Discord's FluxDispatcher does not exist until
 * the webpack runtime has been captured, and every surface below needs it.
 * The promise is memoized: `index.ts` starts the build at adapter start, and
 * the plugin host awaits the same promise before it evaluates any plugin, so
 * a plugin always sees a complete `window.shelter` rather than a partial
 * object it would destructure from.
 */

import type { DomStorage, IonDiscoveryApi } from "@ion/core";
import type { FluxSurface } from "./flux";
import type { HttpSurface } from "./httpapi";
import type { PluginsBridge, PluginsSurface } from "./plugins";
import type { PatcherSurface } from "./patcher";
import type { ScopedApi } from "./scoped";
import type { SettingsSurface } from "./settings";
import type { UiSurface } from "./ui";
import type { UtilSurface } from "./utilapi";

import { initToasts, injectInternalStyles } from "@uwu/shelter-ui";
import htm from "htm/mini";
import solidH from "solid-js/h";
import * as solid from "solid-js";
import * as solidStore from "solid-js/store";
import * as solidWeb from "solid-js/web";

import { adapterLog, errorMessage, shelterLog } from "../logger";
import { createFluxSurface, findDispatcher } from "./flux";
import { createHttpSurface } from "./httpapi";
import { observe } from "./observer";
import { createPatcher } from "./patcher";
import { createPluginsSurface } from "./plugins";
import { createReactSurface } from "./react";
import { createScopedApi } from "./scoped";
import { createSettingsSurface } from "./settings";
import { createUiSurface } from "./ui";
import { createUtilSurface } from "./utilapi";

/** Upstream's `solidH`: hyperscript plus an htm tag bound to it. */
export interface SolidHSurface {
  h: typeof solidH;
  html: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
}

/** The window-level API, before any plugin's `plugin` object is merged in. */
export interface ShelterApiSurface {
  readonly flux: FluxSurface;
  readonly http: HttpSurface;
  readonly patcher: PatcherSurface;
  readonly solid: typeof solid;
  readonly solidStore: typeof solidStore;
  readonly solidWeb: typeof solidWeb;
  readonly solidH: SolidHSurface;
  readonly util: UtilSurface & { createScopedApi(dispatcher?: unknown): ScopedApi };
  readonly plugins: PluginsSurface;
  readonly observeDom: typeof observe;
  readonly ui: UiSurface;
  readonly settings: SettingsSurface;
  /** Throws: the Ion host owns plugin lifecycle, not this API. */
  readonly unload: () => never;
  readonly React: object | undefined;
  readonly ReactDOM: object | undefined;
  readonly ReactDOMClient: object | undefined;
}

export interface ShelterApiDeps {
  readonly discovery: IonDiscoveryApi;
  readonly storage: DomStorage;
  /** The Ion host, wired by the plugin manager. */
  readonly plugins: PluginsBridge;
}

/**
 * How long to wait for Discord's `#app-mount` before reporting that the
 * toast container never mounted. Long enough for a cold client on a slow
 * machine, short enough that a gap shows up in a harness run instead of
 * looking like a hang.
 */
const APP_MOUNT_DEADLINE_MS = 30_000;

/** Poll interval for the app mount; cheap, and it stops once it lands. */
const APP_MOUNT_POLL_MS = 50;

/**
 * Resolves with Discord's `#app-mount` once it has a child, which is the
 * point at which React has rendered and the container can be prepended to
 * it — upstream's `waitForAppMount`, with a deadline so a mount that never
 * comes is an error a log can name rather than a promise nobody observes.
 */
function waitForAppMount(): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + APP_MOUNT_DEADLINE_MS;
    const check = (): void => {
      const mount = document.getElementById("app-mount");
      if (mount !== null && mount.childElementCount > 0) {
        resolve(mount);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("Discord's #app-mount never gained a child"));
        return;
      }
      setTimeout(check, APP_MOUNT_POLL_MS);
    };
    check();
  });
}

async function buildApi(deps: ShelterApiDeps): Promise<ShelterApiSurface> {
  await deps.discovery.onceReady;

  // A build that hides its dispatcher must not take `stores` — and with it
  // every plugin — down with it: the members that need it report it by name.
  const dispatcher = findDispatcher(deps.discovery);
  if (dispatcher === undefined) {
    shelterLog(
      "flux could not resolve Discord's FluxDispatcher; .dispatcher and .intercept will report it, .stores still works",
      "warn",
    );
  }
  const flux = createFluxSurface(deps.discovery, dispatcher);
  const http = createHttpSurface(deps.discovery);
  const settings = createSettingsSurface((message: string) => {
    shelterLog(message, "warn");
  });
  const ui = createUiSurface();
  const scopedDeps = { flux, http, settings };

  // The component library's own startup, both of them upstream's: its
  // internal styles, and the toast container mounted into `#app-mount` once
  // Discord has rendered it. Neither is awaited — the toasts a plugin
  // raises before the container exists wait in the queue it renders.
  injectInternalStyles();
  void waitForAppMount()
    .then(initToasts)
    .catch((error: unknown) => {
      adapterLog("error", `shelter's toast container never mounted: ${errorMessage(error)}`);
    });

  return {
    flux,
    http,
    patcher: createPatcher(),
    solid,
    solidStore,
    solidWeb,
    solidH: {
      h: solidH,
      // htm's own generics resolve against hyperscript's overloaded types;
      // the runtime contract a plugin depends on is "a tagged template that
      // returns DOM", which is what this narrows it to.
      html: htm.bind(solidH),
    },
    util: {
      ...createUtilSurface(flux),
      createScopedApi: (): ScopedApi => createScopedApi(scopedDeps),
    },
    plugins: createPluginsSurface({ ...deps.plugins, ui }),
    observeDom: observe,
    ui,
    settings,
    unload: (): never => {
      throw new Error("shelter.unload is not supported: the Ion host owns plugin lifecycle");
    },
    ...createReactSurface(deps.discovery),
  };
}

let pending: Promise<ShelterApiSurface> | undefined;

/**
 * The one `window.shelter` build. Every caller shares it, so a plugin
 * starting later never sees a half-constructed API.
 */
export function shelterApi(deps: ShelterApiDeps): Promise<ShelterApiSurface> {
  pending ??= buildApi(deps);
  return pending;
}
