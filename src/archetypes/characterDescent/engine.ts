// Pure, deterministic recursion executor for the CHARACTER-DESCENT archetype.
// No React, no Pixi, no I/O, no randomness — this is the correctness-critical core
// (HARD RULE #4). It produces an animation `trace` a renderer can play frame-by-frame,
// and the deterministic gap `signals` that feed the shell's self-heal loop.
//
// This is a deliberate ISLAND (HARD RULE #2): it shares no code with any other
// archetype. The level/signal contract is a plain data shape; the implementation
// stands alone so a different renderer can teach a different concept.

export type BlockId = "stop" | "descend" | "descendSame";

export interface CharacterDescentLevel {
  startDepth: number;
  /** Blocks already in the rule (locked — the scaffolding for this level). */
  preplaced: BlockId[];
  /** Blocks the player may add. */
  palette: BlockId[];
  /** For hint text only. */
  requiredBlocks: BlockId[];
}

/** One beat of the animation. `depth` is the well level the character is acting on. */
export type TraceEvent =
  | { type: "call"; depth: number } // character steps DOWN onto level `depth`
  | { type: "base"; depth: number } // reached the bottom — grab the core & turn around
  | { type: "return"; depth: number } // character climbs back UP to level `depth`
  | { type: "overflow"; depth: number }; // fell past the bottom into the abyss

export interface RunResult {
  trace: TraceEvent[];
  outcome: "success" | "overflow" | "stuck";
  /** Gap signals emitted by this run (deterministic from the rule). */
  signals: string[];
}

/** Hard cap on recursion depth — a missing/broken base case hits this and overflows. */
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

    // Base case: stop at the bottom and grab the core.
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
 * The visible call stack (levels currently open) after playing up to and including
 * `stepIndex`. Push on `call`/`overflow`, pop on `base`/`return`. The renderer uses
 * this to know how deep the character is and which levels to draw.
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

const VALID_BLOCKS: BlockId[] = ["stop", "descend", "descendSame"];
const asBlocks = (x: unknown): BlockId[] =>
  Array.isArray(x) ? x.filter((b): b is BlockId => VALID_BLOCKS.includes(b as BlockId)) : [];

/**
 * Guard CC-authored level data at the boundary (used by module.validate). Throws on
 * malformed input. Lives here in the pure engine — not in module.ts — so the offline
 * authoring server can transpile and run this same check (no React/Pixi to drag in).
 */
export function validate(level: unknown): CharacterDescentLevel {
  const l = level as Record<string, unknown> | null;
  if (!l || typeof l.startDepth !== "number") {
    throw new Error("character-descent: level.startDepth must be a number");
  }
  const preplaced = asBlocks(l.preplaced);
  const palette = asBlocks(l.palette);
  // Solvable only if both a base case (stop) and a shrinking step (descend) are obtainable
  // from the locked + palette blocks — otherwise the character can never reach the core.
  const obtainable = new Set<BlockId>([...preplaced, ...palette]);
  if (!obtainable.has("stop") || !obtainable.has("descend")) {
    throw new Error("character-descent: not solvable — needs stop + descend obtainable");
  }
  return {
    startDepth: l.startDepth,
    preplaced,
    palette,
    requiredBlocks: asBlocks(l.requiredBlocks),
  };
}
