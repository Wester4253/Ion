/**
 * `shelter.http` — Discord's own HTTP client, plus request interception.
 *
 * Upstream finds the client by patching `Function.prototype.bind` until an
 * object with a `get` method shows up, then wraps each method with
 * spitroast so registered interceptors can rewrite or drop a request. Ion
 * already discovers modules, so the client is found by its exported method
 * names and the wrap is a plain function replacement — same observable
 * behaviour, without patching a global prototype to get there.
 *
 * The interception protocol is upstream's, including the per-request
 * interceptor cursor, `sendOnce` throwing when reused, and the rule that an
 * interceptor matches on method *and* URL filter before it runs.
 *
 * (uwu/shelter is CC0-1.0; see THIRD_PARTY.md.)
 */

import type { IonDiscoveryApi } from "@ion/core";

/** Discord's HTTP verbs, in upstream's order. */
const METHODS = ["get", "post", "put", "patch", "del"] as const;

export type HttpMethod = (typeof METHODS)[number];

export interface HttpRequest {
  url: string;
  [key: string]: unknown;
}

export type HttpResponse = Record<string, unknown>;

/** The request handler an interceptor is handed; it must call it exactly once. */
export type SendOnce = (request: HttpRequest | undefined) => Promise<HttpResponse>;

/** An interceptor: receive the request, decide what to send onward. */
export type HttpInterceptor = (request: HttpRequest, send: SendOnce) => Promise<HttpResponse>;

/** A registered interceptor: method, URL filter, handler. */
type Registration = readonly [HttpMethod, (url: string) => boolean, HttpInterceptor];

interface DiscordHttp {
  get(...args: unknown[]): Promise<HttpResponse>;
  post(...args: unknown[]): Promise<HttpResponse>;
  put(...args: unknown[]): Promise<HttpResponse>;
  patch(...args: unknown[]): Promise<HttpResponse>;
  del(...args: unknown[]): Promise<HttpResponse>;
  [key: string]: unknown;
}

function isDiscordHttp(value: unknown): value is DiscordHttp {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return METHODS.every((method) => typeof candidate[method] === "function");
}

function normalizeFilter(
  filter: string | RegExp | ((url: string) => boolean),
): (url: string) => boolean {
  if (typeof filter === "string") return (url) => url === filter;
  if (filter instanceof RegExp) return (url) => filter.test(url);
  return filter;
}

/** What `shelter.http` exposes. */
export interface HttpSurface {
  /** Resolves once Discord's HTTP client was found and wrapped. */
  readonly ready: Promise<void>;
  /** The raw client, for plugins that bypass this surface. */
  readonly _raw: DiscordHttp | undefined;
  get(...args: unknown[]): Promise<HttpResponse>;
  post(...args: unknown[]): Promise<HttpResponse>;
  put(...args: unknown[]): Promise<HttpResponse>;
  patch(...args: unknown[]): Promise<HttpResponse>;
  del(...args: unknown[]): Promise<HttpResponse>;
  intercept(
    method: HttpMethod,
    filter: string | RegExp | ((url: string) => boolean),
    handler: HttpInterceptor,
  ): () => void;
}

/**
 * Builds the HTTP surface and starts looking for Discord's client. The
 * lookup goes through discovery, so a plugin calling a verb before the
 * client exists fails with upstream's own message instead of by reading
 * `undefined`.
 */
export function createHttpSurface(discovery: IonDiscoveryApi): HttpSurface {
  const registrations: Registration[] = [];
  const originals = new Map<HttpMethod, (...args: unknown[]) => Promise<HttpResponse>>();

  let raw: DiscordHttp | undefined;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  function run(
    method: HttpMethod,
    request: HttpRequest,
    secondArgument: unknown,
    self: DiscordHttp,
  ): Promise<HttpResponse> {
    const original = originals.get(method);
    if (original === undefined) return Promise.reject(new Error(`HTTP ${method} is not wrapped`));

    // A fresh cursor per request: every interceptor list starts from the top.
    const cursor = registrations[Symbol.iterator]();

    const send = (next: HttpRequest): Promise<HttpResponse> => {
      const step = cursor.next();
      if (step.done === true) return original.apply(self, [next, secondArgument]);

      const [registeredMethod, filter, handler] = step.value;
      if (registeredMethod !== method || !filter(next.url)) return send(next);

      let used = false;
      const sendOnce: SendOnce = (reused) => {
        if (used) throw new Error("You cannot call 'send' more than once.");
        used = true;
        return send(reused ?? next);
      };
      return handler(next, sendOnce);
    };

    return send(request);
  }

  /** Captures the original verbs, then reroutes every call through `run`. */
  function wrap(client: DiscordHttp): void {
    for (const method of METHODS) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- deliberately unbound: `run` re-applies it to Discord's own client with `.apply(self, ...)`, so binding here would freeze the wrong receiver.
      originals.set(method, client[method]);
      client[method] = (...args: unknown[]): Promise<HttpResponse> => {
        const head = args[0];
        const request: HttpRequest =
          typeof head === "string" ? { url: head } : (head as HttpRequest);
        return run(method, request, args[1], client);
      };
    }
  }

  function accept(found: unknown): void {
    if (raw !== undefined || !isDiscordHttp(found)) return;
    raw = found;
    wrap(found);
    resolveReady();
  }

  accept(discovery.findByProps(...METHODS));
  if (raw === undefined) discovery.waitFor(discovery.filters.byProps(...METHODS), accept);

  function verb(method: HttpMethod): (...args: unknown[]) => Promise<HttpResponse> {
    return (...args: unknown[]): Promise<HttpResponse> => {
      const client = raw;
      if (client === undefined) throw new Error("HTTP method used before API was ready");
      return client[method](...args);
    };
  }

  return {
    ready,
    get _raw() {
      return raw;
    },
    get: verb("get"),
    post: verb("post"),
    put: verb("put"),
    patch: verb("patch"),
    del: verb("del"),
    intercept(method, filter, handler): () => void {
      const registration: Registration = [method, normalizeFilter(filter), handler];
      registrations.push(registration);
      return () => {
        const index = registrations.indexOf(registration);
        if (index !== -1) registrations.splice(index, 1);
      };
    },
  };
}
