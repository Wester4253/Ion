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
