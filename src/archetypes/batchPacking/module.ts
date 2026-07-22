import type { GameModule } from "../../types";
import BatchPacking from "./BatchPacking";
import { validate } from "./engine";
import type { BatchPackingLevel } from "./engine";

// Thin wiring: the registry auto-discovers this GameModule via glob; it meets the shell
// only at the GameModule contract. `validate` (which guards CC-authored data at the
// boundary) lives in the pure engine.ts so the offline authoring server can reuse it.
export const batchPackingModule: GameModule<BatchPackingLevel> = {
  shape: "batch-packing",
  label: "Batch Packing (2D)",
  component: BatchPacking,
  validate,
};
