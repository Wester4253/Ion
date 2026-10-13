// @vitest-environment happy-dom
/**
 * The `shelter.ui` surface: what a plugin can reach, and what it cannot.
 *
 * The surface is built from `@uwu/shelter-ui`'s own export list, so the
 * checks here are about the two exclusions — upstream's four startup
 * helpers, which the adapter runs itself, and the two React↔Solid bridges
 * that are still pending — and about the library actually being compiled
 * in rather than replaced by placeholders.
 */

import * as shelterUi from "@uwu/shelter-ui";
import { describe, expect, it } from "vitest";

import { createUiSurface, PENDING_BRIDGES } from "./ui";

/** Upstream's `without(...)`: startup's own bookkeeping, not plugin API. */
const STARTUP_ONLY = ["cleanupCss", "initToasts", "injectInternalStyles", "InternalStyles"];

describe("createUiSurface", () => {
  it("exposes every library export except the four startup helpers", () => {
    const surface = createUiSurface();
    const members = Object.keys(shelterUi);

    // The package really does ship them; without this the loop below would
    // pass by asserting nothing about the exclusion it claims to test.
    expect(members).toEqual(expect.arrayContaining(STARTUP_ONLY));

    for (const member of members) {
      expect(member in surface).toBe(!STARTUP_ONLY.includes(member));
    }
  });

  it("hands over the compiled components, not placeholders", () => {
    const surface = createUiSurface();

    for (const member of ["showToast", "openModal", "Button", "SwitchItem", "injectCss"]) {
      expect(`${member}:${typeof surface[member]}`).toBe(`${member}:function`);
    }

    // `injectCss` is re-exported from the library so the adapter and a
    // plugin share one implementation, and one stylesheet registry.
    expect(surface.injectCss).toBe(shelterUi.injectCss);
    expect(surface.genId).toBe(shelterUi.genId);
  });

  it("keeps the two pending bridges failing by name", () => {
    const surface = createUiSurface();

    for (const member of PENDING_BRIDGES) {
      const bridge = surface[member];
      expect(`${member}:${typeof bridge}`).toBe(`${member}:function`);
      expect(() => {
        (bridge as () => void)();
      }).toThrow(`shelter.ui.${member} is not available: it is a React↔Solid bridge`);
    }
  });
});
