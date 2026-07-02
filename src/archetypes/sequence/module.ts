import type { GameModule } from "../../types";
import Sequence from "./Sequence";
import type { SequenceLevel, Step } from "./engine";

function validate(level: unknown): SequenceLevel {
  const l = level as { steps?: unknown } | null;
  if (!l || !Array.isArray(l.steps)) {
    throw new Error("sequence: level.steps must be an array");
  }
  const steps: Step[] = l.steps.map((raw) => {
    const s = raw as { id?: unknown; needs?: unknown };
    if (typeof s.id !== "string") throw new Error("sequence: each step needs a string id");
    return {
      id: s.id,
      needs: Array.isArray(s.needs) ? s.needs.filter((x): x is string => typeof x === "string") : [],
    };
  });
  return { steps };
}

export const sequenceModule: GameModule<SequenceLevel> = {
  shape: "sequence",
  label: "Sequence / Process",
  component: Sequence,
  validate,
};
