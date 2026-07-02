import type { GameModule } from "../types";
import { recursiveDescentModule } from "./recursiveDescent/module";
import { sequenceModule } from "./sequence/module";

// shape -> archetype. Add a new game type = add one line here + its module.
export const registry: Record<string, GameModule> = {
  [recursiveDescentModule.shape]: recursiveDescentModule as GameModule,
  [sequenceModule.shape]: sequenceModule as GameModule,
};

export function getModule(shape: string): GameModule | undefined {
  return registry[shape];
}
