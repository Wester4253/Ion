/**
 * Navigation and popup policy.
 *
 * Pure functions: no Electron imports, unit-tested directly.
 */

/** Hostnames whose subdomains may be loaded inside the Ion window. */
const DISCORD_HOST_ROOTS = ["discord.com", "discordapp.com", "discordapp.net"] as const;

function isDiscordHost(hostname: string): boolean {
  return DISCORD_HOST_ROOTS.some((root) => hostname === root || hostname.endsWith(`.${root}`));
}

/**
 * Whether a URL may be loaded as a document inside the Ion window.
 * Only first-party Discord HTTPS documents are allowed; everything else is
 * either handed to the system browser or refused.
 */
export function isAllowedNavigation(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return isDiscordHost(parsed.hostname);
}

/** Whether a URL may be handed to the operating system's default handler. */
export function isAllowedExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:"
  );
}

/**
 * Hosts the catalog fetch bridge may reach. This runs in the main process and
 * so is not subject to the page's Content-Security-Policy — which makes it the
 * real gate, not a formality. It is deliberately narrow and mirrors the CSP
 * `connect-src` grants in `csp.ts`: catalog metadata only (the BetterDiscord
 * and Shelter listings, and GitHub raw for plugin sources). Arbitrary page
 * fetches still go through the page and its CSP.
 */
const FETCH_HOSTS = [
  "api.betterdiscord.app",
  "shindex.uwu.network",
  "raw.githubusercontent.com",
  "userpfp.github.io",
  "cdn.jsdelivr.net",
] as const;

/** Whether a URL may be fetched through the privileged main-process bridge. */
export function isAllowedFetchUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return FETCH_HOSTS.some((host) => parsed.hostname === host);
}
