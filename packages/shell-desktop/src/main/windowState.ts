/**
 * Persisted window state: bounds validation and maximized flag.
 *
 * Pure and unit-tested; file IO lives in `store.ts`.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowState {
  readonly bounds: Rect | null;
  readonly maximized: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = { bounds: null, maximized: false };

/** Smallest window we will restore; smaller values indicate corrupt state. */
const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A display's visible area. Structurally compatible with Electron's Display. */
export interface DisplayArea {
  readonly bounds: Rect;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Validate persisted bounds against the current displays.
 * Returns null when the data is malformed, unreasonably small, or entirely
 * off-screen (e.g. the monitor was unplugged), so the caller falls back to
 * Electron's default placement.
 */
export function sanitizeWindowBounds(raw: unknown, displays: readonly DisplayArea[]): Rect | null {
  if (!isRecord(raw)) return null;

  const { x, y, width, height } = raw;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return null;
  }
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return null;

  const rect: Rect = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
  if (!displays.some((display) => intersects(rect, display.bounds))) return null;
  return rect;
}

/** Coerce persisted window state, falling back field by field. */
export function sanitizeWindowState(raw: unknown, displays: readonly DisplayArea[]): WindowState {
  if (!isRecord(raw)) return DEFAULT_WINDOW_STATE;
  return {
    bounds: sanitizeWindowBounds(raw["bounds"], displays),
    maximized: raw["maximized"] === true,
  };
}
