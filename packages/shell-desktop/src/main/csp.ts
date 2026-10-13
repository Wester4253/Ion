/**
 * Content-Security-Policy extension for Discord documents.
 *
 * Discord's own CSP blocks the hosts that modded clients and their plugins
 * call — vencord.dev for the bundled Vencord set (BadgeAPI fetches
 * badges.vencord.dev at startup and would otherwise fail every load), and
 * GitHub's raw file host for catalog plugins that fetch their data there.
 * Upstream Vencord and Vesktop extend the CSP from their main process the
 * same way (Vendicated/Vencord, src/main/csp); this is Ion's deliberately
 * minimal equivalent: only the grants a measured failure needed, each listed
 * with its consumer, and the whole table recorded in docs/architecture.md.
 * Page-side plugins cannot add grants themselves — the compat facade reports
 * CSP override requests as handled by Ion.
 *
 * Report-only headers are dropped, matching upstream: they would report
 * CSP violations (which patched plugins intentionally cause) to Discord.
 *
 * The policy functions are pure and unit-tested (csp.test.ts). The only
 * Electron reference here is a type-only import, so the tests never load
 * Electron; registerCspHandler wires the functions to the session's header
 * pipeline.
 */

import type { Session } from "electron";

/** Response headers as Electron passes them to the header pipeline. */
export type Headers = Record<string, string[]>;

/**
 * Sources appended to the listed directives of every main-frame response.
 * Keeping this a strict allowlist means every external host Ion lets
 * Discord's document reach is reviewable in one place.
 */
const CSP_GRANTS: readonly (readonly [source: string, directives: readonly string[]])[] = [
  // BadgeAPI (badges.vencord.dev) and its badge images; upstream grants
  // *.vencord.dev connect+img as well (CspPolicies in Vendicated/Vencord).
  ["*.vencord.dev", ["connect-src", "img-src"]],
  // Shelter plugins that fetch their data from GitHub's raw file host:
  // tarp reads `themes.json` and userpfp's database is a github.io manifest
  // whose entries point back at raw.githubusercontent.com. connect for the
  // manifest, img for the avatars it lists. Stock Discord's policy has
  // neither, so this is a deliberate deviation — recorded, with the rest of
  // the table, in docs/architecture.md ("Content-Security-Policy grants").
  // Note tarp's per-theme CSS links are arbitrary hosts and stay blocked.
  ["raw.githubusercontent.com", ["connect-src", "img-src"]],
  // userpfp's own manifest host (source/data.json); it serves no images.
  ["userpfp.github.io", ["connect-src"]],
];

const REPORT_ONLY_HEADER = "content-security-policy-report-only";
const POLICY_HEADER = "content-security-policy";

function findHeader(headers: Headers, name: string): string | undefined {
  return Object.keys(headers).find((header) => header.toLowerCase() === name);
}

/**
 * Split a policy into directive → sources. A bare directive (no sources,
 * e.g. upgrade-insecure-requests) maps to an empty list; the first
 * occurrence of a directive wins, as the CSP spec requires.
 */
export function parsePolicy(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [key, ...sources] = part.trim().split(/\s+/);
    if (key !== undefined && !directives.has(key)) directives.set(key, sources);
  }
  return directives;
}

function stringifyPolicy(directives: Map<string, string[]>): string {
  return [...directives].map(([key, sources]) => [key, ...sources].join(" ")).join("; ");
}

/** Append every grant to a parsed policy, creating directives from default-src as needed. */
export function patchPolicy(policy: string): string {
  const directives = parsePolicy(policy);
  for (const [source, wanted] of CSP_GRANTS) {
    for (const directive of wanted) {
      let sources = directives.get(directive);
      if (sources === undefined) {
        sources = [...(directives.get("default-src") ?? [])];
        directives.set(directive, sources);
      }
      if (!sources.includes(source)) sources.push(source);
    }
  }
  return stringifyPolicy(directives);
}

/**
 * Return one response's headers with the grants applied: the report-only
 * header is dropped and the enforced policy rewritten. Headers without a
 * policy pass through unchanged.
 */
export function applyCspGrants(headers: Headers): Headers {
  const reportOnly = findHeader(headers, REPORT_ONLY_HEADER);
  const policy = findHeader(headers, POLICY_HEADER);
  const result: Headers = {};
  for (const [name, values] of Object.entries(headers)) {
    if (name === reportOnly) continue;
    if (name === policy) {
      const current = values[0];
      result[name] = current === undefined ? values : [patchPolicy(current)];
    } else {
      result[name] = values;
    }
  }
  return result;
}

/** Hook the CSP grants onto the session's header pipeline. */
export function registerCspHandler(ses: Session): void {
  ses.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders } = details;
    // Only the document itself: subresource responses carry their own
    // policies (and none of the granted hosts serve documents).
    if (details.resourceType === "mainFrame" && responseHeaders !== undefined) {
      callback({ cancel: false, responseHeaders: applyCspGrants(responseHeaders) });
    } else {
      callback({ cancel: false });
    }
  });
}
