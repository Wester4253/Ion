/**
 * Semantic-version comparison — a port of BetterDiscord's
 * src/common/semver.ts (Apache-2.0, see THIRD_PARTY.md), adapted from
 * npm/node-semver's comparison rules. Used by `BdApi.Utils.semverCompare`.
 */

// "Official" regex from https://semver.org/
const REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const NUMERIC = /^[0-9]+$/;

function compare(a: string | number, b: string | number): -1 | 0 | 1 {
  const aNumeric = NUMERIC.test(String(a));
  const bNumeric = NUMERIC.test(String(b));

  let left = a;
  let right = b;
  if (aNumeric && bNumeric) {
    left = Number(a);
    right = Number(b);
  }

  if (left === right) return 0;
  if (aNumeric && !bNumeric) return -1;
  if (bNumeric && !aNumeric) return 1;
  if (left < right) return -1;
  return 1;
}

function tokenize(pre: readonly (string | number)[]): (string | number)[] {
  return pre.map((id) => {
    if (!NUMERIC.test(String(id))) return id;
    const num = Number(id);
    // Unsafe numbers stay strings so they compare lexically, like upstream.
    return num >= 0 && num < Number.MAX_SAFE_INTEGER ? num : id;
  });
}

function compareTokens(a: string, b: string): -1 | 0 | 1 {
  const aTokens = tokenize(a.split("."));
  const bTokens = tokenize(b.split("."));

  for (let index = 0; ; index++) {
    const x = aTokens[index];
    const y = bTokens[index];
    if (x === undefined && y === undefined) return 0;
    if (y === undefined) return 1;
    if (x === undefined) return -1;
    if (x === y) continue;
    return compare(x, y);
  }
}

function preCompare(a: string, b: string): -1 | 0 | 1 {
  // Having a prerelease makes it a "lower" version.
  if (a.length && !b.length) return -1;
  if (!a.length && b.length) return 1;
  if (!a.length && !b.length) return 0;
  return compareTokens(a, b);
}

/**
 * Compares two semantic versions, e.g. "1.0.0".
 *
 * @param currentVersion The currently installed version.
 * @param remoteVersion The version to compare against.
 * @returns 0 when equal, -1 when the left side is greater, 1 when the right
 *   side is greater.
 */
export function comparator(currentVersion: string, remoteVersion: string): -1 | 0 | 1 {
  const current = REGEX.exec(currentVersion);
  const remote = REGEX.exec(remoteVersion);

  if (!current || !remote) return 0;

  // Raw match is at [0] so major starts at [1]. Compare major, minor, patch.
  const versionCompare =
    compare(remote[1] ?? "", current[1] ?? "") ||
    compare(remote[2] ?? "", current[2] ?? "") ||
    compare(remote[3] ?? "", current[3] ?? "");

  // Build metadata MUST NOT be considered when determining precedence.
  const prereleaseCompare = preCompare(remote[4] ?? "", current[4] ?? "");

  return versionCompare || prereleaseCompare;
}
