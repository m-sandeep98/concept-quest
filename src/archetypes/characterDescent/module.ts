import type { GameModule } from "../../types";
import CharacterDescent from "./CharacterDescent";
import { validate } from "./engine";
import type { CharacterDescentLevel } from "./engine";

// Thin wiring: the registry auto-discovers this GameModule via glob; it meets the shell
// only at the GameModule contract. `validate` (which guards CC-authored data at the
// boundary) lives in the pure engine.ts so the offline authoring server can reuse it.
export const characterDescentModule: GameModule<CharacterDescentLevel> = {
  shape: "character-descent",
  label: "Character Descent (2D)",
  component: CharacterDescent,
  validate,
};
