import { describe, expect, test } from "vitest";

import { isAllowedExternalUrl, isAllowedNavigation } from "./navigation";

describe("isAllowedNavigation", () => {
  test("allows first-party Discord documents", () => {
    expect(isAllowedNavigation("https://discord.com/app")).toBe(true);
    expect(isAllowedNavigation("https://discord.com/login?redirect_to=%2Fchannels%2Fme")).toBe(
      true,
    );
    expect(isAllowedNavigation("https://ptb.discord.com/channels/@me")).toBe(true);
    expect(isAllowedNavigation("https://canary.discord.com/login")).toBe(true);
    expect(isAllowedNavigation("https://cdn.discordapp.com/avatars/1/a.png")).toBe(true);
    expect(isAllowedNavigation("https://media.discordapp.net/x")).toBe(true);
  });

  test("rejects lookalike domains", () => {
    expect(isAllowedNavigation("https://discord.com.evil.example/app")).toBe(false);
    expect(isAllowedNavigation("https://fakediscord.com/app")).toBe(false);
    expect(isAllowedNavigation("https://notdiscord.com/app")).toBe(false);
    expect(isAllowedNavigation("https://discord.com.evil.example")).toBe(false);
  });

  test("rejects non-https and malformed urls", () => {
    expect(isAllowedNavigation("http://discord.com/app")).toBe(false);
    expect(isAllowedNavigation("file:///etc/passwd")).toBe(false);
    expect(isAllowedNavigation("javascript:alert(1)")).toBe(false);
    expect(isAllowedNavigation("discord://somewhere")).toBe(false);
    expect(isAllowedNavigation("not a url")).toBe(false);
    expect(isAllowedNavigation("")).toBe(false);
  });
});

describe("isAllowedExternalUrl", () => {
  test("allows web and mail links", () => {
    expect(isAllowedExternalUrl("https://example.com/page")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com")).toBe(true);
    expect(isAllowedExternalUrl("mailto:someone@example.com")).toBe(true);
  });

  test("rejects dangerous schemes", () => {
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("smb://host/share")).toBe(false);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
  });
});
