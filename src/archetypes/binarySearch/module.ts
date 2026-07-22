import type { GameModule } from "../../types";
import BinarySearch from "./BinarySearch";
import { validate } from "./engine";
import type { BinarySearchLevel } from "./engine";

// Thin wiring: the registry auto-discovers this GameModule via glob; it meets the shell
// only at the GameModule contract. `validate` (which guards CC-authored data at the
// boundary) lives in the pure engine.ts so the offline authoring server can reuse it.
export const binarySearchModule: GameModule<BinarySearchLevel> = {
  shape: "binary-search",
  label: "Binary Search (2D)",
  component: BinarySearch,
  validate,
};
