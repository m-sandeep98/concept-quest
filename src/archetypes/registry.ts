import type { GameModule } from "../types";

// shape -> archetype, DISCOVERED at build time. Drop a new archetype directory
// (`<shape>/module.ts` exporting a GameModule) and it auto-registers here — no
// edit to this file. This stays the single wiring point; only App imports it
// (HARD RULE #3). All archetypes render on a 2D (PixiJS) stage behind GameProps.
const modules = import.meta.glob("./*/module.ts", { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

function asGameModule(x: unknown): GameModule | null {
  const m = x as Partial<GameModule> | null;
  return m && typeof m.shape === "string" && typeof m.component === "function" && typeof m.validate === "function"
    ? (m as GameModule)
    : null;
}

export const registry: Record<string, GameModule> = {};
for (const mod of Object.values(modules)) {
  for (const exported of Object.values(mod)) {
    const gm = asGameModule(exported);
    if (gm) registry[gm.shape] = gm;
  }
}

export function getModule(shape: string): GameModule | undefined {
  return registry[shape];
}
