import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseProfileArg } from "./profile";

describe("parseProfileArg", () => {
  it("returns null when the flag is absent", () => {
    expect(parseProfileArg(["dist/main.cjs", "--ion-smoke=/tmp/out"])).toBeNull();
  });

  it("returns null for a bare flag without a value", () => {
    expect(parseProfileArg(["--ion-profile"])).toBeNull();
    expect(parseProfileArg(["--ion-profile="])).toBeNull();
  });

  it("resolves the directory relative to the cwd", () => {
    expect(parseProfileArg(["--ion-profile=profiles/p6"])).toBe(resolve("profiles/p6"));
  });

  it("keeps absolute paths intact", () => {
    expect(parseProfileArg(["--ion-profile=/tmp/opencode/ion-profile"])).toBe(
      "/tmp/opencode/ion-profile",
    );
  });

  it("does not match longer flags that merely start with the name", () => {
    expect(parseProfileArg(["--ion-profile-extra=1"])).toBeNull();
  });
});
