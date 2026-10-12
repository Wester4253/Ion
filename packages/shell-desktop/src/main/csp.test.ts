import { describe, expect, test } from "vitest";

import { applyCspGrants, parsePolicy, patchPolicy } from "./csp";

const DISCORD_POLICY =
  "default-src 'self'; connect-src https://discord.com https://status.discord.com; img-src 'self' blob: https://cdn.discordapp.com; upgrade-insecure-requests";

/** The exact rewrite of DISCORD_POLICY: grants appended, order and separators preserved. */
const EXPECTED_PATCHED_POLICY =
  "default-src 'self'; connect-src https://discord.com https://status.discord.com *.vencord.dev; img-src 'self' blob: https://cdn.discordapp.com *.vencord.dev; upgrade-insecure-requests";

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
  test("appends the vencord.dev grants to connect-src and img-src", () => {
    const patched = patchPolicy(DISCORD_POLICY);
    expect(patched).toContain(
      "connect-src https://discord.com https://status.discord.com *.vencord.dev",
    );
    expect(patched).toContain("img-src 'self' blob: https://cdn.discordapp.com *.vencord.dev");
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
    expect(patched).toContain("connect-src 'self' *.vencord.dev");
    expect(patched).toContain("img-src 'self' *.vencord.dev");
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
