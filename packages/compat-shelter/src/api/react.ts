/**
 * `shelter.React` / `shelter.ReactDOM` / `shelter.ReactDOMClient`.
 *
 * Upstream exposes these as live bindings it fills in later by patching
 * `Function.prototype.bind` and waiting for an object that happens to have
 * React's methods — a discovery trick Ion does not need, because Ion already
 * owns webpack discovery. The three are resolved once, when the API is
 * built, and a miss is reported instead of leaving `undefined` behind for a
 * plugin to trip over.
 *
 * Note that these come from Discord's own bundle: a plugin rendering through
 * them shares Discord's React instance, which is what makes patches and
 * portals compose instead of forking the tree.
 */

import type { IonDiscoveryApi } from "@ion/core";

import { adapterLog } from "../logger";

export interface ReactSurface {
  readonly React: object | undefined;
  readonly ReactDOM: object | undefined;
  readonly ReactDOMClient: object | undefined;
}

/** Prop sets upstream's `exfiltrate.ts` effectively matched on. */
const LOOKUPS = [
  ["React", ["createElement", "Component", "cloneElement"]],
  ["ReactDOM", ["createPortal", "render"]],
  ["ReactDOMClient", ["createRoot", "hydrateRoot"]],
] as const;

/** Resolves the three React entry points; warns once per missing one. */
export function createReactSurface(discovery: IonDiscoveryApi): ReactSurface {
  const resolved: Record<string, object | undefined> = {};

  for (const [name, props] of LOOKUPS) {
    const found = discovery.findByProps(...props);
    if (typeof found === "object" && found !== null) {
      resolved[name] = found;
    } else {
      adapterLog("warn", `could not find ${name} (props: ${props.join(", ")})`);
      resolved[name] = undefined;
    }
  }

  return {
    React: resolved["React"],
    ReactDOM: resolved["ReactDOM"],
    ReactDOMClient: resolved["ReactDOMClient"],
  };
}
