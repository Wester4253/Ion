import { describe, expect, test } from "vitest";

import { applyCspGrants, parsePolicy, patchPolicy } from "./csp";

const DISCORD_POLICY =
  "default-src 'self'; connect-src https://discord.com https://status.discord.com; img-src 'self' blob: https://cdn.discordapp.com; upgrade-insecure-requests";

/** Grants in table order: `*.vencord.dev`, then the two GitHub hosts, userpfp's, then loopback. */
const CONNECT_GRANTS =
  "*.vencord.dev raw.githubusercontent.com userpfp.github.io ws://localhost:* http://localhost:*";
const IMG_GRANTS = "*.vencord.dev raw.githubusercontent.com";

/** The exact rewrite of DISCORD_POLICY: grants appended, order and separators preserved. */
const EXPECTED_PATCHED_POLICY =
  `default-src 'self'; connect-src https://discord.com https://status.discord.com ${CONNECT_GRANTS}; ` +
  `img-src 'self' blob: https://cdn.discordapp.com ${IMG_GRANTS}; upgrade-insecure-requests`;

describe("parsePolicy", () => {
  test("splits directives from sources", () => {
    const directives = parsePolicy("default-src 'self'; img-src blob: data:");
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("img-src")).toEqual(["blob:", "data:"]);
  });

  test("keeps bare directives as empty source lists", () => {
    expect(parsePolicy("upgrade-insecure-requests").get("upgrade-insecure-requests")).toEqual([]);
  });

  test("first occurrence of a directive wins", () => {
    expect(parsePolicy("img-src a:; img-src b:").get("img-src")).toEqual(["a:"]);
  });
});

describe("patchPolicy", () => {
  test("appends every grant to connect-src, in table order", () => {
    expect(patchPolicy(DISCORD_POLICY)).toContain(
      `connect-src https://discord.com https://status.discord.com ${CONNECT_GRANTS}`,
    );
  });

  test("appends img grants only to img-src, leaving userpfp's host off it", () => {
    expect(patchPolicy(DISCORD_POLICY)).toContain(
      `img-src 'self' blob: https://cdn.discordapp.com ${IMG_GRANTS}`,
    );
  });

  test("leaves unrelated directives untouched", () => {
    expect(patchPolicy(DISCORD_POLICY)).toContain("default-src 'self'");
  });

  test("is idempotent", () => {
    const once = patchPolicy(DISCORD_POLICY);
    expect(patchPolicy(once)).toBe(once);
  });

  test("creates a missing directive seeded from default-src", () => {
    const patched = patchPolicy("default-src 'self'");
    expect(patched).toContain(`connect-src 'self' ${CONNECT_GRANTS}`);
    expect(patched).toContain(`img-src 'self' ${IMG_GRANTS}`);
  });

  test("grants userpfp's host connect only, never img", () => {
    // The manifest is JSON, not an image: widening img-src would let the page
    // load active content from a host nothing here serves.
    const directives = parsePolicy(patchPolicy(DISCORD_POLICY));
    expect(directives.get("img-src")).not.toContain("userpfp.github.io");
    expect(directives.get("connect-src")).toContain("userpfp.github.io");
  });

  test("grants loopback spelled the way Discord's policy omits", () => {
    // Both Intiface plugins connect to ws://localhost:<port>, and the default
    // policy allows the same loopback only as 127.0.0.1.
    const directives = parsePolicy(patchPolicy(DISCORD_POLICY));
    expect(directives.get("connect-src")).toContain("ws://localhost:*");
    expect(directives.get("connect-src")).toContain("http://localhost:*");
    expect(directives.get("img-src")).not.toContain("ws://localhost:*");
  });

  test("grants no host outside the table", () => {
    // The allowlist is the whole point: everything else stays blocked, and a
    // plugin whose fetch is refused should have to come back here to be fixed.
    const directives = parsePolicy(patchPolicy(DISCORD_POLICY));
    const granted = new Set([...(directives.get("connect-src") ?? [])]);
    for (const host of ["cdn.jsdelivr.net", "github.com", "evil.example"]) {
      expect(granted.has(host)).toBe(false);
    }
  });
});

describe("applyCspGrants", () => {
  test("rewrites the enforced policy and drops the report-only header", () => {
    const headers = {
      "content-security-policy": [DISCORD_POLICY],
      "content-security-policy-report-only": ["img-src 'none'"],
      "content-type": ["text/html"],
    };

    const result = applyCspGrants(headers);

    expect(result["content-security-policy"]).toEqual([EXPECTED_PATCHED_POLICY]);
    expect(result["content-security-policy-report-only"]).toBeUndefined();
    expect(result["content-type"]).toEqual(["text/html"]);
  });

  test("matches the header name case-insensitively", () => {
    const headers = { "Content-Security-Policy": [DISCORD_POLICY] };
    const result = applyCspGrants(headers);
    expect(result["Content-Security-Policy"]).toEqual([EXPECTED_PATCHED_POLICY]);
  });

  test("leaves headers without a policy untouched", () => {
    const headers = { "content-type": ["application/json"] };
    expect(applyCspGrants(headers)).toEqual(headers);
  });
});
