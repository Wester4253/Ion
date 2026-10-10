import { describe, expect, test } from "vitest";

import { sanitizeWindowBounds, sanitizeWindowState } from "./windowState";
import type { DisplayArea } from "./windowState";

const laptop: DisplayArea = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const leftMonitor: DisplayArea = { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } };

describe("sanitizeWindowBounds", () => {
  test("keeps a window that is mostly on screen", () => {
    const bounds = sanitizeWindowBounds({ x: 100, y: 50, width: 1280, height: 720 }, [laptop]);
    expect(bounds).toEqual({ x: 100, y: 50, width: 1280, height: 720 });
  });

  test("keeps a window spanning two displays", () => {
    const bounds = sanitizeWindowBounds({ x: -400, y: 100, width: 1280, height: 720 }, [
      laptop,
      leftMonitor,
    ]);
    expect(bounds).not.toBeNull();
  });

  test("rejects a window on an unplugged display", () => {
    expect(
      sanitizeWindowBounds({ x: 5000, y: 5000, width: 1280, height: 720 }, [laptop]),
    ).toBeNull();
  });

  test("rejects malformed and undersized state", () => {
    expect(sanitizeWindowBounds(null, [laptop])).toBeNull();
    expect(sanitizeWindowBounds({}, [laptop])).toBeNull();
    expect(sanitizeWindowBounds({ x: 0, y: 0, width: "wide", height: 720 }, [laptop])).toBeNull();
    expect(sanitizeWindowBounds({ x: 0, y: 0, width: 100, height: 100 }, [laptop])).toBeNull();
    expect(
      sanitizeWindowBounds({ x: Number.NaN, y: 0, width: 1280, height: 720 }, [laptop]),
    ).toBeNull();
  });

  test("rounds fractional coordinates", () => {
    expect(
      sanitizeWindowBounds({ x: 10.6, y: 20.4, width: 1000.5, height: 700.9 }, [laptop]),
    ).toEqual({
      x: 11,
      y: 20,
      width: 1001,
      height: 701,
    });
  });
});

describe("sanitizeWindowState", () => {
  test("falls back field by field", () => {
    expect(sanitizeWindowState(undefined, [laptop])).toEqual({ bounds: null, maximized: false });
    expect(
      sanitizeWindowState({ bounds: { x: 5, y: 5, width: 900, height: 600 }, maximized: "yes" }, [
        laptop,
      ]),
    ).toEqual({ bounds: { x: 5, y: 5, width: 900, height: 600 }, maximized: false });
    expect(sanitizeWindowState({ maximized: true }, [laptop])).toEqual({
      bounds: null,
      maximized: true,
    });
  });
});
