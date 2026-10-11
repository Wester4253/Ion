/**
 * The Ion plugin registry's built-ins: plugins bundled into the core.
 *
 * These are plain `@ion/plugin-*` packages typed against `@ion/core` (type
 * imports only, so the bundle stays acyclic). Catalog-installed plugins
 * never come through here — they register themselves through
 * `window.__ION__.plugins.register()` at runtime.
 */

import diagnostics from "@ion/plugin-diagnostics";

import type { IonPluginsApi } from "./platform/shell";

export function registerBundledPlugins(host: IonPluginsApi): void {
  host.register(diagnostics);
}
