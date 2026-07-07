// Pure, deterministic finite-state-machine evaluator. No React, no Pixi, no I/O, no
// randomness (HARD RULE #4). The "play" is a WALK: the ordered list of states the player
// drove a token to, one hop per input symbol. This module turns that walk into an
// outcome + the deterministic gap signals that drive the shell's self-heal loop.
//
// The concept: a finite state machine reads an input string one symbol at a time. From
// the current state, each symbol fires exactly the transition arrow LABELED with that
// symbol, moving the token to the next state. The input is ACCEPTED iff the token halts
// on an accepting state after the whole string is consumed. Walking a mislabeled arrow,
// getting stuck where no arrow exists, or halting off an accepting state each fail in a
// distinct, teachable way.
//
// A deliberate ISLAND (HARD RULE #2): shares no code with any other archetype.

export interface FSMTransition {
  /** Source state the arrow leaves. */
  from: string;
  /** Input symbol that fires this arrow. */
  on: string;
  /** Destination state the arrow points to. */
  to: string;
}

export interface StateTraversalLevel {
  /** Every state id in the machine (nodes the token can stand on). */
  states: string[];
  /** The single start state — where the token begins. */
  start: string;
  /** States that count as a win when the token halts on one. */
  accepting: string[];
  /** Labeled transition arrows the token may walk along. */
  transitions: FSMTransition[];
  /** The input string, one symbol per step, fed left to right. */
  input: string[];
}

/** The state ids the token walked to, in order — one entry per consumed input symbol. */
export type Walk = string[];

export type Outcome = "success" | "wrong-transition" | "stuck" | "rejected" | "incomplete";

export interface StepTrace {
  step: number;
  symbol: string;
  from: string;
  to: string;
  valid: boolean;
}

export interface StateTraversalResult {
  outcome: Outcome;
  /** Where the token ended up (the start state if no valid hop was taken). */
  endState: string;
  /** True iff endState is an accepting state. */
  accepted: boolean;
  /** Per-step record of the walk, up to and including the first invalid hop. */
  trace: StepTrace[];
  signals: string[];
}

/** The one arrow leaving `from` labeled `symbol`, or undefined if none exists. */
export function transitionFor(
  level: StateTraversalLevel,
  from: string,
  symbol: string,
): FSMTransition | undefined {
  return level.transitions.find((t) => t.from === from && t.on === symbol);
}

/**
 * Grade a walk against the machine. Deterministic:
 * - `stuck`            the current state has NO arrow for the next symbol (dead end).
 * - `wrong-transition` an arrow exists, but the player walked to the wrong target state.
 * - `incomplete`       every hop was valid but the walk stopped before consuming the input.
 * - `rejected`         the whole input was consumed via valid hops, yet the token halted
 *                      on a non-accepting state.
 * - `success`          all input consumed via correctly-labeled arrows, ending accepting.
 */
export function evaluate(level: StateTraversalLevel, walk: Walk): StateTraversalResult {
  const trace: StepTrace[] = [];
  const signals = new Set<string>();
  let current = level.start;
  let outcome: Outcome | null = null;

  for (let i = 0; i < level.input.length; i++) {
    const symbol = level.input[i];
    if (i >= walk.length) {
      outcome = "incomplete";
      signals.add("incomplete");
      break;
    }
    const chosen = walk[i];
    const arrow = transitionFor(level, current, symbol);
    const valid = arrow !== undefined && arrow.to === chosen;
    trace.push({ step: i, symbol, from: current, to: chosen, valid });
    if (!valid) {
      outcome = arrow === undefined ? "stuck" : "wrong-transition";
      signals.add(outcome);
      break;
    }
    current = chosen;
  }

  if (outcome === null) {
    const won = level.accepting.includes(current);
    outcome = won ? "success" : "rejected";
    if (!won) signals.add("rejected");
  }

  return {
    outcome,
    endState: current,
    accepted: level.accepting.includes(current),
    trace,
    signals: [...signals],
  };
}

/** Guard CC-authored data at the boundary (module.validate) — throws on malformed input. */
export function validate(level: StateTraversalLevel): StateTraversalLevel {
  if (!level || typeof level !== "object") throw new Error("state-traversal: level must be an object");
  const { states, start, accepting, transitions, input } = level;
  const okStr = (s: unknown): s is string => typeof s === "string" && s.length > 0;

  if (!Array.isArray(states) || states.length === 0 || !states.every(okStr))
    throw new Error("state-traversal: `states` must be a non-empty array of non-empty strings");
  const known = new Set(states);
  if (known.size !== states.length) throw new Error("state-traversal: duplicate state ids");
  if (!okStr(start) || !known.has(start)) throw new Error("state-traversal: `start` must be a known state");
  if (!Array.isArray(accepting) || accepting.length === 0 || !accepting.every((s) => known.has(s)))
    throw new Error("state-traversal: `accepting` must be a non-empty subset of `states`");

  if (
    !Array.isArray(transitions) ||
    !transitions.every((t) => t && okStr(t.on) && known.has(t.from) && known.has(t.to))
  )
    throw new Error("state-traversal: each transition needs from/to in `states` and a non-empty `on`");
  const seen = new Set<string>();
  for (const t of transitions) {
    const key = `${t.from}\u0000${t.on}`;
    if (seen.has(key))
      throw new Error(`state-traversal: nondeterministic machine — two arrows leave "${t.from}" on "${t.on}"`);
    seen.add(key);
  }

  if (!Array.isArray(input) || !input.every(okStr))
    throw new Error("state-traversal: `input` must be an array of non-empty symbol strings");
  return level;
}
