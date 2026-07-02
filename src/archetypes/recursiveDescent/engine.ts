// Pure, deterministic recursion executor. No React, no LLM.
// The player assembles a `rule` (ordered blocks); we run it as an actual
// recursion over `startDepth`, produce an animation trace, and detect the
// failure modes that become gap signals.

export type BlockId = "stop" | "descend" | "descendSame";

export interface RecursiveDescentLevel {
  startDepth: number;
  /** Blocks already in the rule (locked — the scaffolding for this level). */
  preplaced: BlockId[];
  /** Blocks the player may add. */
  palette: BlockId[];
  /** For hint text only. */
  requiredBlocks: BlockId[];
}

export type TraceEvent =
  | { type: "call"; depth: number }
  | { type: "base"; depth: number }
  | { type: "return"; depth: number }
  | { type: "overflow"; depth: number };

export interface RunResult {
  trace: TraceEvent[];
  outcome: "success" | "overflow" | "stuck";
  /** Gap signals emitted by this run (deterministic from the rule). */
  signals: string[];
}

/** Hard cap on recursion depth — a missing/broken base case hits this. */
export const STEP_CAP = 12;

export function run(rule: BlockId[], startDepth: number): RunResult {
  const hasStop = rule.includes("stop");
  const shrinks = rule.includes("descend");
  const same = rule.includes("descendSame");
  const hasDescent = shrinks || same;

  const trace: TraceEvent[] = [];
  let steps = 0;
  let overflowed = false;
  let reachedCore = false;

  function recurse(depth: number): void {
    if (overflowed) return;
    steps += 1;
    if (steps > STEP_CAP) {
      overflowed = true;
      trace.push({ type: "overflow", depth });
      return;
    }
    trace.push({ type: "call", depth });

    // Base case: stop and return the core.
    if (hasStop && depth <= 0) {
      reachedCore = true;
      trace.push({ type: "base", depth });
      return;
    }
    // No recursive step at all — the rule just ends here.
    if (!hasDescent) return;

    // Recursive step. `descend` shrinks toward the base; `descendSame` does not.
    const next = shrinks ? depth - 1 : depth;
    recurse(next);
    if (!overflowed) trace.push({ type: "return", depth });
  }

  recurse(startDepth);

  const signals = new Set<string>();
  let outcome: RunResult["outcome"];
  if (overflowed) {
    outcome = "overflow";
    if (!hasStop) signals.add("missing-base-case");
    else if (same && !shrinks) signals.add("no-progress");
    else signals.add("missing-base-case");
  } else if (reachedCore) {
    outcome = "success";
  } else {
    // Terminated without reaching the core (e.g. no descent on a deep well).
    outcome = "stuck";
  }

  return { trace, outcome, signals: [...signals] };
}

/**
 * The visible call stack after animating up to (and including) `stepIndex`.
 * Push on `call`/`overflow`, pop on `base`/`return`.
 */
export function stackAt(trace: TraceEvent[], stepIndex: number): number[] {
  const stack: number[] = [];
  for (let i = 0; i <= stepIndex && i < trace.length; i += 1) {
    const e = trace[i];
    if (e.type === "call" || e.type === "overflow") stack.push(e.depth);
    else stack.pop();
  }
  return stack;
}
