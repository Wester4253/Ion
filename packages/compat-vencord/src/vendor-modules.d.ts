/**
 * Ambient declarations for the vendored Vencord modules the adapter's own
 * code imports, plus the host-facing globals the vendored sources consume.
 *
 * This file is deliberately a global script (no top-level import/export):
 * `declare module "..."` in a module file would be an augmentation of an
 * unresolvable module, which skipLibCheck would silently swallow.
 *
 * The vendored tree is compiled by esbuild (which resolves the `@api/*`,
 * `@utils/*`, ... aliases to vendor/vencord/src/*) but deliberately excluded
 * from `tsc` — upstream is typechecked by upstream. These declarations list
 * the exact subset of each module's surface that `src/` consumes, so a
 * mismatch between our usage and the real exports surfaces as a type error
 * here rather than a silent build.
 */

/** The host native facade installed by src/shims/globals.ts. */
interface VencordNativeApi {
  readonly settings: {
    /** Synchronous: the vendored Settings store reads it at module eval. */
    get(): Record<string, unknown>;
    set(settings: Record<string, unknown>, path?: string): Promise<void>;
    openFolder(): void;
  };
  readonly native: {
    openExternal(url: string): Promise<void>;
    getVersions(): { electron?: string; chrome?: string };
    getRendererCss(): Promise<string>;
    onRendererCssUpdate(listener: (css: string) => void): () => void;
    supportsWindowsMaterial(): Promise<boolean>;
  };
  readonly quickCss: {
    get(): Promise<string>;
    set(css: string): Promise<void>;
    addChangeListener(listener: (css: string) => void): () => void;
    addThemeChangeListener(listener: () => void): () => void;
    openEditor(): void;
  };
  readonly themes: {
    getThemesList(): Promise<readonly import("./themes").VencordUserThemeHeader[]>;
    getThemeData(fileName: string): Promise<string>;
    getSystemValues(): Promise<Record<string, string | undefined>>;
    uploadTheme(fileName: string, data: string): Promise<void>;
    deleteTheme(fileName: string): Promise<void>;
    openFolder(): void;
  };
  readonly updater: {
    getRepo(): Promise<{ ok: boolean; value?: string; error?: string }>;
    getUpdates(): Promise<{ ok: boolean; value?: never; error?: string }>;
    update(): Promise<{ ok: boolean; value?: never; error?: string }>;
    rebuild(): Promise<{ ok: boolean; value?: boolean; error?: string }>;
  };
  readonly csp: {
    isDomainAllowed(): Promise<boolean>;
    requestAddOverride(): Promise<{ ok: boolean; value?: never; error?: string }>;
  };
}

interface Window {
  /** Installed by src/shims/globals.ts; consumed by the vendored sources. */
  VencordNative?: VencordNativeApi;
  /** Probed by Vesktop-flavored plugin code (IS_VESKTOP builds). */
  VesktopNative?: {
    app: {
      getRendererCss(): Promise<string>;
      getVersion(): Promise<string>;
      isOutdated(): Promise<boolean>;
      onRendererCssUpdate(listener: (css: string) => void): () => void;
      openUpdater(): void;
      relaunch(): void;
    };
  };
}

declare module "@api" {
  /** The upstream API barrel; the adapter only re-exports it. */
}

declare module "@api/PluginManager" {
  export function startPlugin(plugin: import("./types").VencordPlugin): boolean;
  export function stopPlugin(plugin: import("./types").VencordPlugin): boolean;
  export function subscribePluginFluxEvents(
    plugin: import("./types").VencordPlugin,
    fluxDispatcher: import("./types").VencordFluxDispatcher,
  ): void;
  export const plugins: Record<string, import("./types").VencordPlugin>;
}

declare module "@api/Settings" {
  export const Settings: import("./types").VencordSettingsStore;
  export const PlainSettings: Record<string, unknown>;
  export const SettingsStore: {
    addChangeListener(path: string, listener: () => void): void;
  };
}

declare module "@api/Styles" {
  export function initStyles(): void;
}

declare module "@components" {
  /** The upstream component barrel; the adapter only re-exports it. */
}

declare module "@utils" {
  /** The upstream utility barrel; the adapter only re-exports it. */
}

declare module "@utils/Logger" {
  export class Logger {
    constructor(name: string, color?: string);
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    debug(...args: unknown[]): void;
  }
}

declare module "@utils/lazy" {
  export function makeLazy<T>(factory: () => T, attempts?: number): () => T;
}

declare module "@utils/lazyReact" {
  export function LazyComponent<T>(factory: () => T, attempts?: number): T;
}

declare module "@utils/patches" {
  export function canonicalizeMatch<T extends string | RegExp>(match: T): T;
  export function canonicalizeReplace<T extends string | ((...args: string[]) => string)>(
    replacement: T,
    pluginPath: string,
  ): T;
}

declare module "@utils/updater" {
  /** The upstream updater facade; the adapter only re-exports it. */
}

declare module "@webpack/common" {
  export let FluxDispatcher: import("./types").VencordFluxDispatcher | undefined;
}

declare module "~plugins" {
  const plugins: Record<string, import("./types").VencordPlugin>;
  export default plugins;
  export const PluginMeta: Record<string, { folderName: string; userPlugin: boolean }>;
  export const ExcludedPlugins: Record<string, string>;
}

declare module "~git-hash" {
  const hash: string;
  export default hash;
}

declare module "~git-remote" {
  const remote: string;
  export default remote;
}
