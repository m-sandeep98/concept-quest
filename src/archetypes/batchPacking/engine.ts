// Pure, deterministic batch-packing evaluator. No React, no Pixi, no I/O, no randomness
// (HARD RULE #4). The "play" is an assignment of each request to a batch. This module
// turns that assignment into an outcome + the deterministic gap signals that drive the
// shell's self-heal loop.
//
// The concept: a fixed-capacity resource (a GPU) processes requests in BATCHES. Packing
// many requests into each batch keeps the resource full — high throughput — but a batch
// whose requests exceed capacity overflows its memory. Spreading requests thin (nearly
// one-per-batch) wastes the resource. This is the shape behind "why vLLM": continuous
// batching for throughput, bounded by memory (PagedAttention).
//
// A deliberate ISLAND (HARD RULE #2): shares no code with any other archetype.

export interface BatchRequest {
  /** Stable id, unique within the level. */
  id: string;
  /** Memory/compute the request occupies while running (capacity units). */
  size: number;
}

export interface BatchPackingLevel {
  /** Max total request size a single batch can hold (the resource's memory). */
  capacity: number;
  /** Max batches for a clean win — the throughput target. Fewer batches = higher throughput. */
  budget: number;
  /** The requests waiting to be served. */
  requests: BatchRequest[];
}

/** requestId -> batch index (0-based). Missing/negative = unassigned (not yet placed). */
export type Assignment = Record<string, number>;

export type Outcome = "success" | "overcommit" | "underutilize";

export interface BatchLoad {
  batch: number;
  load: number;
  over: boolean;
}

export interface BatchRunResult {
  outcome: Outcome;
  /** Number of non-empty batches used. */
  batchesUsed: number;
  budget: number;
  /** Load in each used batch, ascending by batch index. */
  loads: BatchLoad[];
  /** Batch indices whose load exceeds capacity. */
  overCapacity: number[];
  signals: string[];
}

/** True once every request has a (non-negative) batch assignment. */
export function allAssigned(level: BatchPackingLevel, a: Assignment): boolean {
  return level.requests.every((r) => typeof a[r.id] === "number" && a[r.id] >= 0);
}

/** Total size loaded into each used batch, keyed by batch index. */
export function batchLoads(level: BatchPackingLevel, a: Assignment): Map<number, number> {
  const loads = new Map<number, number>();
  for (const r of level.requests) {
    const b = a[r.id];
    if (typeof b !== "number" || b < 0) continue;
    loads.set(b, (loads.get(b) ?? 0) + r.size);
  }
  return loads;
}

/**
 * Grade a full assignment (every request must be placed — the component enforces this).
 * Deterministic:
 * - `overcommit`   if ANY used batch's load exceeds capacity (memory overflow / OOM).
 * - `underutilize` if everything fit under capacity but it used MORE batches than budget
 *                  (spreading work thin instead of packing the resource full).
 */
export function evaluate(level: BatchPackingLevel, a: Assignment): BatchRunResult {
  const loadMap = batchLoads(level, a);
  const batches = [...loadMap.keys()].sort((x, y) => x - y);
  const loads: BatchLoad[] = batches.map((b) => {
    const load = loadMap.get(b) ?? 0;
    return { batch: b, load, over: load > level.capacity };
  });
  const overCapacity = loads.filter((l) => l.over).map((l) => l.batch);
  const batchesUsed = batches.length;

  const signals = new Set<string>();
  let outcome: Outcome;
  if (overCapacity.length > 0) {
    outcome = "overcommit";
    signals.add("overcommit");
  } else if (batchesUsed > level.budget) {
    outcome = "underutilize";
    signals.add("underutilize");
  } else {
    outcome = "success";
  }
  return { outcome, batchesUsed, budget: level.budget, loads, overCapacity, signals: [...signals] };
}
