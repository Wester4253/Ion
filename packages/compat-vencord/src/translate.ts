/**
 * Vencord plugin definition → Ion plugin manifest.
 *
 * This is the adapter's heart: it turns one upstream `definePlugin` object
 * into an `IonPlugin` the native host can own, while the vendored upstream
 * plugin manager (startPlugin/stopPlugin) keeps executing the actual
 * feature registration exactly as it does in Vesktop:
 *
 * - patches: canonicalized (`#{intl::}`, `\i`, `$self` → the plugin's global
 *   path) and handed to the Ion patch engine via the manifest, registered
 *   and removed by the host like any native plugin,
 * - feature fields (commands, context menus, chat bar buttons, ...): the
 *   vendored manager registers them in start()/stop(), including its
 *   implicit API-plugin dependencies (a plugin with commands pulls in
 *   CommandsAPI, ...),
 * - enablement: Vencord's `Settings.plugins.<name>.enabled` store stays the
 *   single source of truth through the `enabledState` seam; a change
 *   listener drives the host so the Vencord settings UI and Ion's panel can
 *   both toggle plugins,
 * - lifecycle stages: upstream's `startAt` maps onto the host's stages, so
 *   e.g. a plugin subscribing to Flux waits for webpack readiness without
 *   delaying its patches.
 */

import { startPlugin, stopPlugin, subscribePluginFluxEvents } from "@api/PluginManager";
import { Settings, SettingsStore } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { canonicalizeMatch, canonicalizeReplace } from "@utils/patches";
import { FluxDispatcher } from "@webpack/common";

import type { IonPlugin, IonPluginPatch } from "@ion/core";
import type { VencordPatch, VencordPatchReplacement, VencordPlugin, VencordStartAt } from "./types";

const logger = new Logger("CompatVencord");

type IonReplacement = Extract<IonPluginPatch["replacement"], readonly unknown[]>[number];

export interface TranslateOptions {
  /** Names of every plugin in the loaded set (implicit deps must exist). */
  readonly availablePlugins: ReadonlySet<string>;
}

/** Upstream's implicit API-plugin dependencies (see initPluginManager). */
const IMPLICIT_DEPENDENCIES: readonly (readonly [keyof VencordPlugin, string])[] = [
  ["commands", "CommandsAPI"],
  ["onBeforeMessageEdit", "MessageEventsAPI"],
  ["onBeforeMessageSend", "MessageEventsAPI"],
  ["onMessageClick", "MessageEventsAPI"],
  ["chatBarButton", "ChatInputButtonAPI"],
  ["renderMemberListDecorator", "MemberListDecoratorsAPI"],
  ["renderMessageAccessory", "MessageAccessoriesAPI"],
  ["renderMessageDecoration", "MessageDecorationsAPI"],
  ["messagePopoverButton", "MessagePopoverAPI"],
  ["userProfileBadge", "BadgeAPI"],
];

/** Hooks upstream binds to the plugin object before registering them. */
const BOUND_HOOKS = [
  "onBeforeMessageEdit",
  "onBeforeMessageSend",
  "onMessageClick",
  "renderMemberListDecorator",
  "renderMessageAccessory",
  "renderMessageDecoration",
] as const satisfies readonly (keyof VencordPlugin)[];

const START_AT: Record<VencordStartAt, NonNullable<IonPlugin["startAt"]>> = {
  Init: "init",
  WebpackReady: "webpack-ready",
  DOMContentLoaded: "dom-ready",
};

function translatePatch(patch: VencordPatch, pluginPath: string): IonPluginPatch {
  const replacements: IonReplacement[] = [];
  // Upstream accepts a single replacement object or a list. Array.isArray
  // would narrow to any[], so the element type is carried by this guard.
  const isReplacementList = (
    value: VencordPatchReplacement | readonly VencordPatchReplacement[],
  ): value is readonly VencordPatchReplacement[] => Array.isArray(value);
  const rawReplacements = isReplacementList(patch.replacement)
    ? patch.replacement
    : [patch.replacement];
  for (const raw of rawReplacements) {
    if (raw.predicate && !raw.predicate()) continue;
    // Value-level canonicalization: the plugin definition stays pristine so
    // re-enabling re-registers identical patches.
    replacements.push({
      match: canonicalizeMatch(raw.match),
      // Upstream's ReplaceFn narrows its arguments to strings; Ion's
      // replacement type mirrors String.replace's wider callback. Both are
      // invoked with the same String.replace arguments at runtime.
      replace: canonicalizeReplace(raw.replace, pluginPath) as IonReplacement["replace"],
    });
  }

  const translated: IonPluginPatch = {
    find: canonicalizeMatch(patch.find),
    replacement: replacements,
  };
  return {
    ...translated,
    ...(patch.all === undefined ? {} : { all: patch.all }),
    ...(patch.group === undefined ? {} : { group: patch.group }),
    ...(patch.predicate === undefined ? {} : { predicate: patch.predicate }),
    ...(patch.fromBuild === undefined ? {} : { fromBuild: patch.fromBuild }),
    ...(patch.toBuild === undefined ? {} : { toBuild: patch.toBuild }),
  };
}

function collectDependencies(
  definition: VencordPlugin,
  options: TranslateOptions,
): string[] | undefined {
  const dependencies = new Set<string>(definition.dependencies ?? []);

  for (const [field, api] of IMPLICIT_DEPENDENCIES) {
    if (definition[field] == null) continue;
    if (options.availablePlugins.has(api)) dependencies.add(api);
    else {
      logger.warn(
        `${definition.name}: uses ${field} but ${api} is not part of the loaded set — that feature will not work`,
      );
    }
  }

  return dependencies.size > 0 ? [...dependencies] : undefined;
}

function bindHooks(definition: VencordPlugin): void {
  const mutable = definition as unknown as Record<string, unknown>;
  for (const key of BOUND_HOOKS) {
    if (typeof mutable[key] === "function") {
      mutable[key] = (mutable[key] as (...args: unknown[]) => unknown).bind(definition);
    }
  }
}

/** Wire the upstream settings object: pluginName + per-option listeners. */
function wireSettings(definition: VencordPlugin): void {
  const { settings } = definition;
  if (!settings) return;

  settings.pluginName = definition.name;
  for (const [key, option] of Object.entries(settings.def)) {
    if (option.onChange) {
      SettingsStore.addChangeListener(`plugins.${definition.name}.${key}`, option.onChange);
    }
  }
}

export function translatePlugin(definition: VencordPlugin, options: TranslateOptions): IonPlugin {
  const id = /\s/.test(definition.name) ? definition.name.replace(/\s+/g, "_") : definition.name;
  const pluginPath = `Vencord.Plugins.plugins[${JSON.stringify(definition.name)}]`;

  bindHooks(definition);
  wireSettings(definition);

  // A Vencord settings-UI toggle (or an Ion panel toggle) flips the store;
  // this listener hands the change to the host, whose state guards make the
  // resulting re-entry a no-op. See plugins.ts (setEnabled).
  SettingsStore.addChangeListener(`plugins.${definition.name}.enabled`, () => {
    void window.__ION__?.plugins?.setEnabled(
      id,
      Boolean(Settings.plugins[definition.name]?.enabled),
    );
  });

  return {
    id,
    name: definition.name,
    description: definition.description,
    authors: definition.authors?.map((author) => ({ name: author.name })),
    required: definition.required,
    defaultEnabled: Boolean(definition.enabledByDefault),
    dependencies: collectDependencies(definition, options),
    startAt:
      definition.startAt === "Init" ? undefined : START_AT[definition.startAt ?? "WebpackReady"],
    patches: definition.patches?.map((patch) => translatePatch(patch, pluginPath)),
    enabledState: {
      read: () => Settings.plugins[definition.name]?.enabled,
      write: (enabled) => {
        // Reading through the proxy seeds the entry (the store's
        // getDefaultValue fills defaults from ~plugins), so a missing
        // entry means the plugin never made it into the registry.
        const entry = Settings.plugins[definition.name];
        if (!entry) {
          logger.error(`settings entry for ${definition.name} missing; cannot persist enablement`);
          return;
        }
        entry.enabled = enabled;
      },
    },
    start: () => {
      if (!startPlugin(definition)) {
        throw new Error(`upstream startPlugin failed for ${definition.name} (see log above)`);
      }
      // If Flux has not appeared yet, the vendored common modules subscribe
      // every enabled plugin's flux events the moment it does, so nothing
      // is lost by skipping here.
      if (definition.flux && FluxDispatcher) {
        subscribePluginFluxEvents(definition, FluxDispatcher);
      }
    },
    stop: () => {
      // The upstream manager guards every feature removal with its own
      // `started` flag; only drive it when it actually started.
      if (definition.started) stopPlugin(definition);
    },
  };
}
