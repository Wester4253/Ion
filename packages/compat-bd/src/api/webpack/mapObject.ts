/**
 * `mapObject` — BetterDiscord's mapper-based export renaming, ported from
 * src/betterdiscord/utils/object.ts (Apache-2.0, see THIRD_PARTY.md): for
 * each mapper key, the first source value passing its filter is bound to
 * that key through a live getter/setter, so writes pass straight through
 * to the source module. Keys with no match resolve to `undefined`.
 */

import type { ExportedOnlyFilter } from "./types";

export function mapObject<T extends object>(
  source: object,
  mappers: Record<keyof T, ExportedOnlyFilter>,
): T {
  const mapped = Object.create(null) as Partial<T>;
  const values = source as Record<string, unknown>;
  const mapperKeys = Object.keys(mappers) as (keyof T)[];

  for (const searchKey of Object.keys(values)) {
    if (!Object.prototype.hasOwnProperty.call(values, searchKey)) continue;
    for (const key of mapperKeys) {
      if (!Object.prototype.hasOwnProperty.call(mappers, key)) continue;
      if (Object.prototype.hasOwnProperty.call(mapped, key)) continue;
      if (mappers[key](values[searchKey])) {
        Object.defineProperty(mapped, key, {
          get() {
            return values[searchKey];
          },
          set(value) {
            values[searchKey] = value;
          },
          enumerable: true,
          configurable: false,
        });
      }
    }
  }

  for (const key of mapperKeys) {
    if (!Object.prototype.hasOwnProperty.call(mapped, key)) {
      Object.defineProperty(mapped, key, {
        value: undefined,
        enumerable: true,
        configurable: false,
      });
    }
  }

  return mapped as T;
}
