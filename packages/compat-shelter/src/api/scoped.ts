/**
 * The per-plugin scoped API: `shelter.plugin.scoped`.
 *
 * A behavioural port of uwu/shelter's `src/util/scopedApi.ts` (CC0-1.0, see
 * THIRD_PARTY.md). Every registration a plugin makes through this object is
 * recorded in `disposes`, so `disposeAllNow()` — which the host calls when
 * the plugin stops — tears the plugin back out of the page: dispatcher
 * subscriptions, flux/http interceptors, DOM observations, patches, and
 * injected styles. A cleanup that throws is caught and logged rather than
 * aborting the remaining cleanups, upstream's rule, because one broken
 * teardown must not leave five live hooks behind.
 *
 * Two additions on top of upstream's shape:
 *
 * - Callbacks handed to `flux`, `http`, `observeDom`, and `patcher` run under
 *   the owning plugin's log scope, so a failure inside a subscription is
 *   reported against the plugin that registered it.
 * - Nothing here returns `undefined` by accident: each registration returns
 *   the same unregister upstream returns, which is also what gets recorded
 *   for disposal.
 */

import type { FluxSurface, Interceptor } from "./flux";
import type { HttpInterceptor, HttpMethod, HttpSurface } from "./httpapi";
import type { Unobserve } from "./observer";
import type { PatcherSurface } from "./patcher";
import type { SettingsSection, SettingsSurface } from "./settings";
import type { PluginScope } from "../logger";

import { runInPluginScope, shelterLog, wrapInPluginScope } from "../logger";
import { observe } from "./observer";
import { createPatcher } from "./patcher";
import { injectCss } from "./ui";

/** A cleanup registered against a plugin's scope. */
type Disposer = () => void;

/** What one plugin's `shelter.plugin.scoped` exposes. */
export interface ScopedApi {
  readonly disposes: Disposer[];
  disposeAllNow(): void;
  onDispose(callback: Disposer): void;
  readonly flux: {
    subscribe(type: string, callback: (payload: Record<string, unknown>) => void): Disposer;
    intercept(callback: Interceptor): Disposer;
  };
  readonly http: {
    intercept(
      method: HttpMethod,
      filter: Parameters<HttpSurface["intercept"]>[1],
      handler: HttpInterceptor,
    ): Disposer;
  };
  readonly observeDom: typeof observe;
  readonly patcher: PatcherSurface;
  readonly settings: SettingsSurface;
  readonly ui: { injectCss: typeof injectCss };
}

export interface ScopedApiDeps {
  readonly flux: FluxSurface;
  readonly http: HttpSurface;
  readonly settings: SettingsSurface;
}

/**
 * Builds one plugin's scope. Omitting `scope` produces the window-level
 * scope `shelter.util.createScopedApi` hands out: same registrations and
 * same disposes list, but nothing runs under a plugin's name.
 */
export function createScopedApi(deps: ScopedApiDeps, scope?: PluginScope): ScopedApi {
  const disposes: Disposer[] = [];

  const remember = (unregister: Disposer): Disposer => {
    disposes.push(unregister);
    return unregister;
  };

  /** Runs `callback` under the owning plugin, if there is one. */
  const scoped = <R>(callback: () => R): R =>
    scope === undefined ? callback() : runInPluginScope(scope, callback);

  /** Wraps a plugin-supplied callback so its runs are attributed. */
  const wrap = <A extends unknown[], R>(callback: (...args: A) => R): ((...args: A) => R) =>
    scope === undefined ? callback : wrapInPluginScope(scope, callback);

  return {
    disposes,

    disposeAllNow(): void {
      for (const cleanup of disposes.splice(0, disposes.length)) {
        try {
          cleanup();
        } catch (error) {
          scoped(() => {
            shelterLog(
              ["Caught error while cleaning up scoped APIs, continuing safely.", error],
              "error",
            );
          });
        }
      }
    },

    onDispose(callback: Disposer): void {
      disposes.push(callback);
    },

    flux: {
      subscribe(type, callback): Disposer {
        const subscribed = wrap(callback);
        deps.flux.dispatcher.subscribe(type, subscribed);
        return remember(() => {
          deps.flux.dispatcher.unsubscribe(type, subscribed);
        });
      },
      intercept(callback): Disposer {
        return remember(deps.flux.intercept(wrap(callback)));
      },
    },

    http: {
      intercept(method, filter, handler): Disposer {
        return remember(deps.http.intercept(method, filter, wrap(handler)));
      },
    },

    observeDom(selector, callback): Unobserve {
      const unobserve = observe(selector, wrap(callback));
      remember(unobserve);
      return unobserve;
    },

    patcher: createPatcher(scope === undefined ? {} : { disposes, scope }),

    settings: {
      BadgeType: deps.settings.BadgeType,
      registerSection: (...sections: SettingsSection[]): Disposer =>
        remember(scoped(() => deps.settings.registerSection(...sections))),
    },

    ui: {
      injectCss: (css: string): ((replacement?: string) => void) => remember(injectCss(css)),
    },
  };
}
