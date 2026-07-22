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

/**
 * Guard CC-authored level data at the boundary (used by module.validate). Throws on
 * malformed input. Lives here in the pure engine — not in module.ts — so the offline
 * authoring server can transpile and run this same check (no React/Pixi to drag in).
 */
export function validate(level: unknown): BatchPackingLevel {
  const l = level as Record<string, unknown> | null;
  const capacity = l?.capacity;
  const budget = l?.budget;
  if (typeof capacity !== "number" || capacity <= 0) {
    throw new Error("batch-packing: level.capacity must be a positive number");
  }
  if (typeof budget !== "number" || budget < 1) {
    throw new Error("batch-packing: level.budget must be a positive integer");
  }
  const raw = l?.requests;
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error("batch-packing: level.requests must have ≥2 entries");
  }
  const seen = new Set<string>();
  const requests: BatchRequest[] = raw.map((r, i) => {
    const rr = r as Record<string, unknown> | null;
    const id = typeof rr?.id === "string" && rr.id ? rr.id : `r${i + 1}`;
    if (seen.has(id)) throw new Error(`batch-packing: duplicate request id "${id}"`);
    seen.add(id);
    const size = rr?.size;
    if (typeof size !== "number" || size <= 0) {
      throw new Error(`batch-packing: request "${id}" size must be a positive number`);
    }
    if (size > capacity) {
      throw new Error(`batch-packing: request "${id}" (size ${size}) can't fit capacity ${capacity}`);
    }
    return { id, size };
  });
  // Necessary feasibility: the whole load must fit within budget batches at capacity.
  const total = requests.reduce((s, r) => s + r.size, 0);
  if (total > capacity * budget) {
    throw new Error(`batch-packing: not solvable — total size ${total} exceeds capacity × budget (${capacity * budget})`);
  }
  return { capacity, budget, requests };
}
