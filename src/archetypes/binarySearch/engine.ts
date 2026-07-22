// Pure, deterministic binary-search evaluator. No React, no Pixi, no I/O, no randomness
// (HARD RULE #4). The "play" here is a sequence of probes (vault indices the player
// opened). This module turns that sequence into an outcome + the deterministic gap
// signals that drive the shell's self-heal loop.
//
// A deliberate ISLAND (HARD RULE #2): shares no code with any other archetype.

export interface BinarySearchLevel {
  /** Sorted ascending, distinct. Each is a vault's number. */
  values: number[];
  /** Index within `values` the player must find. */
  targetIndex: number;
  /** Max probes allowed for a clean win. Defaults to the log2 optimum + 1. */
  budget?: number;
}

export type Dir = "higher" | "lower" | "found";

export interface RunResult {
  outcome: "success" | "slow" | "sloppy";
  probesUsed: number;
  budget: number;
  signals: string[];
}

/** Fewest probes a perfect binary search needs for `size` items. */
export function optimal(size: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(1, size))));
}

export function budgetFor(level: BinarySearchLevel): number {
  return level.budget ?? optimal(level.values.length) + 1;
}

/** What the opened vault at `index` tells the player about where the target is. */
export function dirFor(values: number[], targetIndex: number, index: number): Dir {
  const target = values[targetIndex];
  const v = values[index];
  if (v === target) return "found";
  return v < target ? "higher" : "lower";
}

/**
 * The still-possible index band [lo, hi] after replaying `probes`. Push the low
 * bound up on "higher", pull the high bound down on "lower". This is the feasible
 * region a correct searcher would confine guesses to — the renderer dims the rest.
 */
export function feasibleAfter(
  values: number[],
  targetIndex: number,
  probes: number[],
): { lo: number; hi: number } {
  let lo = 0;
  let hi = values.length - 1;
  for (const p of probes) {
    const d = dirFor(values, targetIndex, p);
    if (d === "higher") lo = Math.max(lo, p + 1);
    else if (d === "lower") hi = Math.min(hi, p - 1);
  }
  return { lo, hi };
}

/** True if probing `index` ignores the feedback gathered so far (outside the band). */
export function isOutOfRange(
  values: number[],
  targetIndex: number,
  priorProbes: number[],
  index: number,
): boolean {
  const { lo, hi } = feasibleAfter(values, targetIndex, priorProbes);
  return index < lo || index > hi;
}

/**
 * Grade a full probe sequence (which must end at the target). Deterministic:
 * - `ignored-feedback` if any probe fell outside the then-feasible band.
 * - `not-halving`     if the search stayed in-range but took more probes than budget
 *                     (i.e. linear-scanning instead of cutting the range in half).
 */
export function evaluate(level: BinarySearchLevel, probes: number[]): RunResult {
  const budget = budgetFor(level);
  let outOfRange = false;
  const seen: number[] = [];
  for (const p of probes) {
    if (isOutOfRange(level.values, level.targetIndex, seen, p)) outOfRange = true;
    seen.push(p);
  }
  const probesUsed = probes.length;
  const signals = new Set<string>();
  let outcome: RunResult["outcome"];
  if (outOfRange) {
    outcome = "sloppy";
    signals.add("ignored-feedback");
  } else if (probesUsed > budget) {
    outcome = "slow";
    signals.add("not-halving");
  } else {
    outcome = "success";
  }
  return { outcome, probesUsed, budget, signals: [...signals] };
}

/**
 * Guard CC-authored level data at the boundary (used by module.validate). Throws on
 * malformed input. Lives here in the pure engine — not in module.ts — so the offline
 * authoring server can transpile and run this same check (no React/Pixi to drag in).
 */
export function validate(level: unknown): BinarySearchLevel {
  const l = level as Record<string, unknown> | null;
  const values = l?.values;
  if (!Array.isArray(values) || values.length < 2 || !values.every((n) => typeof n === "number")) {
    throw new Error("binary-search: level.values must be an array of ≥2 numbers");
  }
  // Must be sorted ascending — the whole game depends on it.
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] <= values[i - 1]) throw new Error("binary-search: level.values must be strictly ascending");
  }
  const ti = l?.targetIndex;
  if (typeof ti !== "number" || ti < 0 || ti >= values.length) {
    throw new Error("binary-search: level.targetIndex out of range");
  }
  return {
    values: values as number[],
    targetIndex: ti,
    budget: typeof l?.budget === "number" ? (l.budget as number) : undefined,
  };
}
