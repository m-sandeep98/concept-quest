import type { GameModule } from "../types";
import { characterDescentModule } from "./characterDescent/module";
import { binarySearchModule } from "./binarySearch/module";

// shape -> archetype. Add a new game type = add one line here + its module.
// All archetypes render on a 2D (PixiJS) stage behind the GameProps contract.
export const registry: Record<string, GameModule> = {
  [characterDescentModule.shape]: characterDescentModule as GameModule,
  [binarySearchModule.shape]: binarySearchModule as GameModule,
};

export function getModule(shape: string): GameModule | undefined {
  return registry[shape];
}
