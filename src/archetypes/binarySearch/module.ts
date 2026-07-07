import type { GameModule } from "../../types";
import BinarySearch from "./BinarySearch";
import type { BinarySearchLevel } from "./engine";

// Guards Claude-Code-authored level data at the boundary. Throws on malformed input.
function validate(level: unknown): BinarySearchLevel {
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

export const binarySearchModule: GameModule<BinarySearchLevel> = {
  shape: "binary-search",
  label: "Binary Search (2D)",
  component: BinarySearch,
  validate,
};
