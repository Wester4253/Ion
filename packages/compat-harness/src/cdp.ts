/**
 * Minimal CDP client for the compat harness — Node built-ins only.
 *
 * Drives a headless Ion instance over the Chrome DevTools Protocol:
 * discovers the page target over HTTP, talks WebSocket JSON-RPC, and
 * evaluates expressions in the page (where `window.__ION__` lives).
 * No third-party dependency: Node 22 ships both `fetch` and `WebSocket`.
 */

/** One CDP connection to a page target. */
export class CdpSession {
  #socket: WebSocket;
  #nextId = 0;
  #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  #listeners: ((message: CdpMessage) => void)[] = [];
  #closed = false;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (event: MessageEvent) => {
      // Responses carry `id`; events do not. Model both with one shape.
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        error?: { message?: string };
        result?: unknown;
        method?: string;
        params?: Record<string, unknown>;
      };
      if (typeof message.id === "number") {
        const waiter = this.#pending.get(message.id);
        if (!waiter) return;
        this.#pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message ?? "CDP error"));
        else waiter.resolve(message.result);
        return;
      }
      if (message.method !== undefined) {
        for (const listener of this.#listeners) {
          listener({ method: message.method, params: message.params });
        }
      }
    });
    socket.addEventListener("close", () => {
      this.#closed = true;
      for (const waiter of this.#pending.values()) waiter.reject(new Error("CDP socket closed"));
      this.#pending.clear();
    });
  }

  /** Send a CDP command and resolve with its result. */
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error("CDP session closed"));
    const id = (this.#nextId += 1);
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
  }

  /** Subscribe to CDP events (e.g. Runtime.consoleAPICalled). */
  onEvent(listener: (message: CdpMessage) => void): () => void {
    this.#listeners.push(listener);
    return () => {
      this.#listeners = this.#listeners.filter((entry) => entry !== listener);
    };
  }

  /**
   * Evaluate an expression in the page main world. Resolves with the
   * JSON-cloned value; rejects when the expression threw, carrying the
   * page's exception text.
   */
  async evaluate(expression: string): Promise<unknown> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as EvaluateResult;
    if (result.exceptionDetails) {
      const text =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "evaluation failed";
      throw new Error(text);
    }
    return result.result?.value;
  }

  close(): void {
    if (!this.#closed) this.#socket.close();
  }
}

/** Shape of an unsolicited CDP event push. */
interface CdpMessage {
  readonly method?: string;
  readonly params?: Record<string, unknown> | undefined;
}

interface EvaluateResult {
  readonly result?: { readonly value?: unknown } | undefined;
  readonly exceptionDetails?:
    { readonly text?: string; readonly exception?: { readonly description?: string } } | undefined;
}

interface TargetInfo {
  readonly type?: string | undefined;
  readonly webSocketDebuggerUrl?: string | undefined;
}

/** Wait until the debug endpoint answers; returns the base URL. */
export async function waitForDebugEndpoint(
  port: number,
  timeoutMs = 30_000,
  host = "127.0.0.1",
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no attempt made";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${host}:${String(port)}/json/version`);
      if (response.ok) return `http://${host}:${String(port)}`;
      lastError = `HTTP ${String(response.status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`debug endpoint on port ${String(port)} never came up (${lastError})`);
}

/**
 * Connect to the first page target (Ion opens one window). Retries while
 * the target list is still empty — Electron registers it after `app.ready`.
 */
export async function connectToPage(baseUrl: string, timeoutMs = 30_000): Promise<CdpSession> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no attempt made";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/json`);
      const targets = (await response.json()) as TargetInfo[];
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) {
        return new CdpSession(new WebSocket(page.webSocketDebuggerUrl));
      }
      lastError = "no page target yet";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no page target appeared (${lastError})`);
}

/**
 * Open a session and enable the domains the harness relies on, then run
 * `work(session)`. Renderer console errors are collected throughout and
 * returned alongside the result so runs can assert `rendererErrors: []`.
 */
export async function withSession<T>(
  baseUrl: string,
  work: (session: CdpSession) => Promise<T>,
): Promise<{ value: T; rendererErrors: string[] }> {
  const session = await connectToPage(baseUrl);
  const rendererErrors: string[] = [];
  session.onEvent((message) => {
    const params = message.params;
    if (message.method === "Runtime.exceptionThrown") {
      const details = params?.["exceptionDetails"] as
        { text?: string; exception?: { description?: string } } | undefined;
      rendererErrors.push(
        details?.exception?.description ?? details?.text ?? "unknown page exception",
      );
    } else if (message.method === "Runtime.consoleAPICalled" && params?.["type"] === "error") {
      const args = (params["args"] ?? []) as { value?: unknown; description?: string }[];
      const text = args
        .map((arg) => (typeof arg.value === "string" ? arg.value : (arg.description ?? "")))
        .join(" ");
      if (text.trim().length > 0) rendererErrors.push(text);
    }
  });
  await session.send("Runtime.enable");
  try {
    const value = await work(session);
    return { value, rendererErrors };
  } finally {
    session.close();
  }
}
