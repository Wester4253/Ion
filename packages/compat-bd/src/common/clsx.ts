/**
 * `className` — BetterDiscord re-exports clsx for `BdApi.Utils.className`.
 * This is a faithful port of clsx's semantics (MIT, ljharb — see
 * THIRD_PARTY.md): strings and numbers are appended as-is, arrays are
 * flattened recursively, and for objects the keys are appended when their
 * value is truthy. Falsy values (null, undefined, false, 0, "") are skipped.
 */

/** Anything `className` accepts: strings, numbers, arrays, or key maps. */
export type ClassValue =
  string | number | bigint | boolean | null | undefined | ClassValue[] | Record<string, unknown>;

function toVal(mix: ClassValue): string {
  if (typeof mix === "string") return mix;
  if (typeof mix === "number" || typeof mix === "bigint") return String(mix);
  if (typeof mix !== "object" || mix === null) return "";

  if (Array.isArray(mix)) {
    let str = "";
    for (const item of mix) {
      const value = toVal(item);
      if (value) str = str ? `${str} ${value}` : value;
    }
    return str;
  }

  let str = "";
  for (const key in mix) {
    if (mix[key] && key) str = str ? `${str} ${key}` : key;
  }
  return str;
}

export function clsx(...inputs: ClassValue[]): string {
  let str = "";
  for (const input of inputs) {
    const value = toVal(input);
    if (value) str = str ? `${str} ${value}` : value;
  }
  return str;
}
