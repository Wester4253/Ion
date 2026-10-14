/**
 * BetterDiscord's live listing, parsed from the page itself.
 *
 * The store's JSON API (api.betterdiscord.app/v1/store/addons) was retired —
 * every /v1/store path now answers with a redirect off-site — so the listing
 * is the server-rendered page: Svelte SSR cards, each carrying its own
 * `download?id=N` link. This module holds only the pure parse, pinned by a
 * test against the real card shape, so a silent page redesign fails loudly
 * instead of sweeping zero plugins.
 */

export interface BdListingCard {
  /** The card's detail link: `/plugins/<slug>`. */
  readonly slug: string;
  /** The download id the card itself carries. */
  readonly downloadId: string;
  /** The card's rendered title — the fallback when no meta header parses. */
  readonly title: string;
}

/**
 * betterdiscord.app sits behind Cloudflare bot management that answers a
 * bare User-Agent with HTTP 500. The header set a desktop browser sends
 * (fetch hints included) gets 200; the listing and its downloads share
 * the requirement.
 */
export function bdHeaders(): Record<string, string> {
  return {
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  };
}

/** The handful of HTML entities a rendered plugin title can carry. */
function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"');
}

/**
 * Splits the rendered page into cards. Every card is an
 * `<a class="card-wrap" href="/plugins/<slug>">` containing its download
 * link, its title, and nested anchors (the author link) — so the split is on
 * the card-wrap marker itself, never to a closing `</a>`, which would cut
 * cards short at the first nested anchor. The featured rail repeats cards
 * that also appear in the grid; the caller dedupes by download id.
 */
export function parseBdListing(html: string): BdListingCard[] {
  const cards: BdListingCard[] = [];
  for (const chunk of html.split('<a class="card-wrap').slice(1)) {
    const slug = /^[^>]*?href="\/plugins\/([^"]+)"/.exec(chunk)?.[1];
    const downloadId = /download\?id=(\d+)/.exec(chunk)?.[1];
    const title = /card-title[^>]*>([^<]+)</.exec(chunk)?.[1];
    if (slug === undefined || downloadId === undefined || title === undefined) continue;
    cards.push({ slug, downloadId, title: decodeEntities(title) });
  }
  return cards;
}
