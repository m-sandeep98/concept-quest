import type { GameModule } from "../../types";
import BatchPacking from "./BatchPacking";
import type { BatchPackingLevel, BatchRequest } from "./engine";

// Guards Claude-Code-authored level data at the boundary. Throws on malformed input.
function validate(level: unknown): BatchPackingLevel {
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

export const batchPackingModule: GameModule<BatchPackingLevel> = {
  shape: "batch-packing",
  label: "Batch Packing (2D)",
  component: BatchPacking,
  validate,
};
