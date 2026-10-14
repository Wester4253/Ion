/**
 * One hand-written line per known BetterDiscord index-sweep failure.
 *
 * A sweep scores the *live* store, so its entries are generated at run time
 * and cannot carry a `diagnosis` the way the pinned starter set in
 * `packages/compat-bd/acceptance.json` does. These lines fill that gap:
 * each was written after reading the downloaded plugin for a run (the run's
 * artifacts pin every file by digest, so it can be re-read), and each says
 * what is *verified from that source*. Where no line could be isolated it
 * says so instead of guessing — a diagnosis renders beside the measured
 * reason, never instead of it, so both stay visible.
 *
 * Nothing here downgrades a failure.
 */
export const BD_INDEX_DIAGNOSES: Readonly<Record<string, string>> = {};
