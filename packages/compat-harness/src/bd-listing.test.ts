import { describe, expect, test } from "vitest";

import { parseBdListing } from "./bd-listing";

/**
 * A faithful slice of betterdiscord.app/plugins as served 2026-10-14: the
 * card-wrap anchor, the nested author anchor that would cut a naive
 * `</a>`-terminated match short, the per-card download link, a title with
 * an HTML entity, and a rail link that is not a card at all.
 */
const LISTING = `<!DOCTYPE html><html><body>
<nav><a class="card-wrap svelte-x" href="/plugins/NotACard">a link with no card body</a></nav>
<a class="card-wrap svelte-1udyrqm" href="/plugins/NoReplyPing"><div class="card svelte-1udyrqm"><!--[-1--><!--]--><!----> <img loading="lazy" class="card-image" src="./image/1286" alt="Thumbnail NoReplyPing"/> <div class="card-body"><h3 class="card-title svelte-1udyrqm">NoReplyPing</h3> <p class="card-subtext">by <object title="Author Link"><a class="anchor author-link" rel="noreferrer noopener" href="./developers/Qb">Qb</a></p> <a href="./download?id=938">Download</a></div></div></a><!----><a class="card-wrap svelte-1udyrqm" href="https://external.example/skip">download?id=1 lives here but the href is not a plugin</a><!----><a class="card-wrap svelte-1udyrqm" href="/plugins/ThemeAndMore"><div class="card"><h3 class="card-title svelte-1udyrqm">Theme &amp; More</h3> <a href="./download?id=1044">Download</a></div></a>
</body></html>`;

describe("parseBdListing", () => {
  test("pairs each card's title with its own download id past nested anchors", () => {
    // The NoReplyPing card contains a nested author anchor; a split to the
    // first closing </a> would cut the card before its download link.
    expect(parseBdListing(LISTING)).toEqual([
      { slug: "NoReplyPing", downloadId: "938", title: "NoReplyPing" },
      { slug: "ThemeAndMore", downloadId: "1044", title: "Theme & More" },
    ]);
  });

  test("skips links that carry the marker but are not plugin cards", () => {
    // The nav link has no download id; the external rail link's href is not
    // a /plugins/ path. Neither becomes a card.
    const slugs = parseBdListing(LISTING).map((card) => card.slug);
    expect(slugs).not.toContain("NotACard");
    expect(slugs).not.toContain("https://external.example/skip");
  });

  test("returns nothing for a page whose shape changed", () => {
    expect(parseBdListing("<html><body><p>redesigned</p></body></html>")).toEqual([]);
  });
});
