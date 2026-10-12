/**
 * The `@webpack/patcher` shim.
 *
 * Upstream, this module is the plugin patch registry: `initPluginManager`
 * pushes patches here and the chunk hook applies them. Ion replaces both —
 * patches are declared on each translated plugin manifest and registered
 * with the Ion patch engine (see src/translate.ts and the core host).
 *
 * The vendored PluginManager imports the bindings for its (unused here)
 * init path, so they exist with honest behavior: touching `addPatch`
 * directly is a programming error in an Ion context and says so.
 */

export const patches: readonly unknown[] = [];

export function addPatch(): never {
  throw new Error(
    "compat-vencord: patches register through the Ion plugin host, not @webpack/patcher.addPatch",
  );
}
