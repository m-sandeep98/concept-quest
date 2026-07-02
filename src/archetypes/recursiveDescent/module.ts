import type { GameModule } from "../../types";
import RecursiveDescent from "./RecursiveDescent";
import type { BlockId, RecursiveDescentLevel } from "./engine";

const VALID: BlockId[] = ["stop", "descend", "descendSame"];
const asBlocks = (x: unknown): BlockId[] =>
  Array.isArray(x) ? x.filter((b): b is BlockId => VALID.includes(b as BlockId)) : [];

// Guards Claude-Code-authored level data at the boundary. Throws on malformed input.
function validate(level: unknown): RecursiveDescentLevel {
  const l = level as Record<string, unknown> | null;
  if (!l || typeof l.startDepth !== "number") {
    throw new Error("recursive-descent: level.startDepth must be a number");
  }
  return {
    startDepth: l.startDepth,
    preplaced: asBlocks(l.preplaced),
    palette: asBlocks(l.palette),
    requiredBlocks: asBlocks(l.requiredBlocks),
  };
}

export const recursiveDescentModule: GameModule<RecursiveDescentLevel> = {
  shape: "recursive-descent",
  label: "Recursive Descent",
  component: RecursiveDescent,
  validate,
};
