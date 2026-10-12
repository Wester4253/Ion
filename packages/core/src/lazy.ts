/**
 * Lazy module lookups that may not exist yet (a module typically only
 * evaluates after its lazy chunk loads).
 *
 * The semantics deliberately mirror upstream Vencord's `proxyLazy`
 * (vendored verbatim in vendor/vencord/src/utils/lazy.ts), because the
 * compatibility adapter depends on them:
 *
 * - The factory runs on first use. A null/undefined result or a thrown
 *   error is never cached — later accesses retry, so a lookup that ran
 *   before webpack loaded its chunk still succeeds on a later read. Once
 *   `attempts` runs out, the last error is thrown, never swallowed.
 * - A read in the same tick the lazy was created returns another lazy
 *   instead of forcing an evaluation that cannot succeed yet, so
 *   `const { a, b } = someLazy` defers both properties until use.
 * - Every other operation (calls, construction, `in`, keys, prototype,
 *   writes) forwards to the evaluated value.
 */

/** Function-own properties that are non-configurable; proxies must not lie about them. */
const UNCONFIGURABLE_FUNCTION_KEYS = ["arguments", "caller", "prototype"] as const;

const SENTINEL = function lazySentinel(): undefined {
  // Never invoked: every operation on the proxy goes through the traps below.
  return undefined;
};

export function proxyLazy<T>(factory: () => T, attempts = 10, isChild = false): T {
  let isSameTick = true;
  if (!isChild)
    setTimeout(() => {
      isSameTick = false;
    }, 0);

  let tries = 0;
  let cache: T | undefined;
  let lastError: unknown = new Error("lazy value was never evaluated");

  const evaluate = (): T => {
    if (cache !== undefined) return cache;
    if (attempts <= tries) {
      throw lastError instanceof Error
        ? lastError
        : new Error(`lazy evaluation failed: ${String(lastError)}`);
    }
    tries += 1;
    let value: T;
    try {
      value = factory();
    } catch (error) {
      lastError = error;
      throw error;
    }
    if (value == null) {
      lastError = new Error(
        `[ion] lazy factory returned ${value === null ? "null" : "undefined"} (${String(tries)}/${String(attempts)} attempts)`,
      );
      throw lastError;
    }
    cache = value;
    return value;
  };

  /**
   * Evaluate and narrow to an object for the Reflect traps. A primitive lazy
   * value is a caller bug; mirroring upstream, it raises a descriptive error
   * instead of boxing it away with Object(value), which would hide the bug.
   */
  const evaluateObject = (property?: PropertyKey): object => {
    const value = evaluate();
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
      throw new Error(
        property === undefined
          ? "[ion] proxyLazy: lazy value is not an object"
          : `[ion] proxyLazy: cannot read ${String(property)} of a primitive value`,
      );
    }
    return value;
  };

  return new Proxy(SENTINEL, {
    get(_target, property, receiver) {
      // Same-tick reads defer into a child lazy (upstream's destructuring
      // behavior): `const { x } = lazy` must not force the factory.
      if (!isChild && isSameTick) {
        return proxyLazy(
          () => Reflect.get(evaluateObject(property), property, receiver) as unknown,
          attempts,
          true,
        );
      }
      return Reflect.get(evaluateObject(property), property, receiver) as unknown;
    },
    has(_target, property) {
      return Reflect.has(evaluateObject(), property);
    },
    ownKeys() {
      // Proxy invariants require the sentinel's non-configurable keys to be
      // visible; everything else comes from the evaluated value.
      const keys = Reflect.ownKeys(evaluateObject());
      for (const key of UNCONFIGURABLE_FUNCTION_KEYS) {
        if (!keys.includes(key)) keys.push(key);
      }
      return keys;
    },
    getOwnPropertyDescriptor(target, property) {
      if (
        typeof property === "string" &&
        (UNCONFIGURABLE_FUNCTION_KEYS as readonly string[]).includes(property)
      ) {
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
      return Reflect.getOwnPropertyDescriptor(evaluateObject(), property);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(evaluateObject());
    },
    apply(_target, thisArg, args) {
      const value = evaluate();
      if (typeof value !== "function") {
        throw new Error("[ion] proxyLazy: lazy value is not callable");
      }
      return Reflect.apply(value, thisArg, args) as unknown;
    },
    construct(_target, args, newTarget) {
      const value = evaluate();
      if (typeof value !== "function") {
        throw new Error("[ion] proxyLazy: lazy value is not constructable");
      }
      return Reflect.construct(value, args, newTarget) as object;
    },
    set(_target, property, value, receiver) {
      return Reflect.set(evaluateObject(), property, value, receiver);
    },
    defineProperty(_target, property, descriptor) {
      return Reflect.defineProperty(evaluateObject(), property, descriptor);
    },
    deleteProperty(_target, property) {
      return Reflect.deleteProperty(evaluateObject(), property);
    },
    setPrototypeOf(_target, prototype) {
      return Reflect.setPrototypeOf(evaluateObject(), prototype);
    },
    // isExtensible/preventExtensions deliberately have no trap: proxy
    // invariants tie their answers to the sentinel, so forwarding them to
    // the evaluated value could only produce invariant TypeErrors.
  }) as T;
}
