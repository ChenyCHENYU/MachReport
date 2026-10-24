import type { Parameters } from "fast-check";

/** CI records the seed; fast-check also prints the minimized counterexample and replay path. */
export function fuzzOptions(salt: number, maximumRuns = 10_000): Pick<Parameters, "seed" | "numRuns" | "verbose" | "path"> {
  const seed = Number(process.env.MR_FUZZ_SEED ?? 5_067_345 + salt), runs = Number(process.env.MR_FUZZ_RUNS ?? 250);
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(runs) || runs < 1 || runs > 100_000) throw new Error("Invalid MR_FUZZ_SEED/MR_FUZZ_RUNS");
  return { seed: seed | 0, numRuns: Math.min(runs, maximumRuns), verbose: true, ...(process.env.MR_FUZZ_PATH ? { path: process.env.MR_FUZZ_PATH } : {}) };
}
