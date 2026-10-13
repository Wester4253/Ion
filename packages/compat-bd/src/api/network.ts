/**
 * `BdApi.Net` — network access for plugins. A port of
 * src/betterdiscord/api/net.ts (Apache-2.0, see THIRD_PARTY.md).
 *
 * Upstream routes through Electron's `net` module over an IPC bridge,
 * which runs outside the page's CORS rules. Ion's shell does not expose a
 * fetch bridge to plugins (widening the IPC surface is a deliberate,
 * reviewed change), so this uses the page's own `fetch` — subject to
 * Discord's CORS and CSP like any page request. The deviation is recorded
 * in THIRD_PARTY.md.
 */

export class Net {
  /** Fetches a URL with the page's own fetch. */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }
}

Object.freeze(Net);
Object.freeze(Net.prototype);
