// @vitest-environment happy-dom
/**
 * The `shelter.ui` surface: what a plugin can reach, and what it cannot.
 *
 * The surface is built from `@uwu/shelter-ui`'s own export list, so the
 * checks here are about the one exclusion — upstream's four startup helpers,
 * which the adapter runs itself — and about the library actually being
 * compiled in rather than replaced by placeholders. What the two
 * React↔Solid bridges *do* is covered in `bridges.test.tsx`, against a
 * stand-in for Discord's React; here they only have to be present, and to
 * fail naming themselves when this session has no React to run them on.
 */

import * as shelterUi from "@uwu/shelter-ui";
import { describe, expect, it } from "vitest";

import type { ReactSurface } from "./react";
import { createUiSurface } from "./ui";

/** Upstream's `without(...)`: startup's own bookkeeping, not plugin API. */
const STARTUP_ONLY = ["cleanupCss", "initToasts", "injectInternalStyles", "InternalStyles"];

/** A session whose discovery resolved none of Discord's React objects. */
const NO_REACT: ReactSurface = {
  React: undefined,
  ReactDOM: undefined,
  ReactDOMClient: undefined,
};

describe("createUiSurface", () => {
  it("exposes every library export except the four startup helpers", () => {
    const surface = createUiSurface(NO_REACT);
    const members = Object.keys(shelterUi);

    // The package really does ship them; without this the loop below would
    // pass by asserting nothing about the exclusion it claims to test.
    expect(members).toEqual(expect.arrayContaining(STARTUP_ONLY));

    for (const member of members) {
      expect(member in surface).toBe(!STARTUP_ONLY.includes(member));
    }
  });

  it("hands over the compiled components, not placeholders", () => {
    const surface = createUiSurface(NO_REACT);

    for (const member of ["showToast", "openModal", "Button", "SwitchItem", "injectCss"]) {
      expect(`${member}:${typeof surface[member]}`).toBe(`${member}:function`);
    }

    // `injectCss` is re-exported from the library so the adapter and a
    // plugin share one implementation, and one stylesheet registry.
    expect(surface.injectCss).toBe(shelterUi.injectCss);
    expect(surface.genId).toBe(shelterUi.genId);
  });

  it("ships the two React↔Solid bridges", () => {
    const surface = createUiSurface(NO_REACT);

    expect(typeof surface.ReactInSolidBridge).toBe("function");
    expect(typeof surface.renderSolidInReact).toBe("function");
  });

  it("fails the bridges by name when this session resolved no Discord React", () => {
    const surface = createUiSurface(NO_REACT);

    expect(() => {
      surface.ReactInSolidBridge({ comp: () => null });
    }).toThrow("shelter.ui.ReactInSolidBridge needs Discord's React instance");
    expect(() => {
      surface.renderSolidInReact(() => null);
    }).toThrow("shelter.ui.renderSolidInReact needs Discord's React instance");
  });
});
