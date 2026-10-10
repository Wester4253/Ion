/**
 * Lazy evaluation helpers for module lookups that are not ready yet
 * (a module may only exist after a lazy chunk loads).
 *
 * `proxyLazy` evaluates the factory on first property access and retries a
 * bounded number of times — one retry per subsequent access — so a lookup
 * that runs before Discord has loaded its module still succeeds on a later
 * read. After the attempts are exhausted the last error is thrown, never
 * swallowed.
 *
 * The proxy target is a function (so lazy results can be called); the
 * target-first descriptor/ownKeys handling below exists to satisfy Proxy
 * invariants for the function's own non-configurable properties.
 */

export function proxyLazy<T>(factory: () => T, attempts = 10): T {
  const sentinel = function lazySentinel(): undefined {
    // Never invoked: every access on the proxy goes through the traps below.
    return undefined;
  };
  const sentinelKeys = Reflect.ownKeys(sentinel);

  let cache: { readonly value: T } | undefined;
  let remaining = attempts;
  let lastError: unknown = new Error("lazy value was never evaluated");

  const evaluate = (): T => {
    if (cache) return cache.value;
    if (remaining <= 0) {
      throw lastError instanceof Error
        ? lastError
        : new Error(`lazy evaluation failed: ${String(lastError)}`);
    }
    remaining -= 1;
    try {
      const value = factory();
      cache = { value };
      return value;
    } catch (error) {
      lastError = error;
      throw error;
    }
  };

  const resolveObject = (): object => {
    const value = evaluate();
    if (value == null) throw new Error("[ion] lazy value evaluated to null/undefined");
    return Object(value) as object;
  };

  return new Proxy(sentinel, {
    get(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (descriptor && !descriptor.configurable && "value" in descriptor && !descriptor.writable) {
        return descriptor.value as unknown;
      }
      return Reflect.get(resolveObject(), property) as unknown;
    },
    has(_target, property) {
      return Reflect.has(resolveObject(), property);
    },
    ownKeys() {
      return [...new Set([...sentinelKeys, ...Reflect.ownKeys(resolveObject())])];
    },
    getOwnPropertyDescriptor(target, property) {
      return (
        Reflect.getOwnPropertyDescriptor(target, property) ??
        Reflect.getOwnPropertyDescriptor(resolveObject(), property) ??
        undefined
      );
    },
    apply(_target, thisArg, args) {
      const value = evaluate();
      if (typeof value !== "function") {
        throw new Error("[ion] lazy value is not callable");
      }
      return Reflect.apply(value, thisArg, args) as unknown;
    },
  }) as T;
}
