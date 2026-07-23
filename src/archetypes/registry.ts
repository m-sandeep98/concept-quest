import { lazy } from "react";
import type { FC } from "react";
import type { GameModule, GameProps } from "../types";

// shape -> archetype, DISCOVERED at build time. Drop a new archetype directory and it
// auto-registers here — no edit to this file. This stays the single wiring point; only App
// imports it (HARD RULE #3). All archetypes render on a 2D (PixiJS) stage behind GameProps.
//
// Registration is MANIFEST-DRIVEN and FAULT-ISOLATED. Two globs are eager and CANNOT dangle:
//   • archetype.manifest.json — plain data; gives the shape + label.
//   • engine.ts               — pure per HARD RULE #4 (no React/Pixi/I-O), always present even
//                               mid-authoring; owns `validate`, the boundary guard.
// The render layer (module.ts → Component + scene, which pulls in Pixi and is the part still
// being authored when a shape is scaffolded contract-first) is globbed LAZILY and wrapped in
// React.lazy. So an INCOMPLETE archetype — manifest + engine present, Component.tsx not yet
// written — no longer crashes the whole app at import time. Its shape still registers; the
// component only loads when its game is opened, where GameHost's error boundary reports it.

interface ManifestMeta {
  shape?: unknown;
  label?: unknown;
}

const manifests = import.meta.glob("./*/archetype.manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, ManifestMeta>;

const engines = import.meta.glob("./*/engine.ts", { eager: true }) as Record<
  string,
  { validate?: (level: unknown) => unknown }
>;

// LAZY on purpose: a broken/missing ./Component in one archetype's module.ts must not break
// the others. Each entry is `() => import("./<shape>/module.ts")`, transformed only on play.
const moduleLoaders = import.meta.glob("./*/module.ts") as Record<
  string,
  () => Promise<Record<string, unknown>>
>;

/** "./characterDescent/engine.ts" -> "./characterDescent/" */
const dirOf = (key: string): string => key.slice(0, key.lastIndexOf("/") + 1);

/** Pull the GameModule's component out of a loaded module.ts (export name is arbitrary). */
function pickComponent(mod: Record<string, unknown>): FC<GameProps> | null {
  for (const exported of Object.values(mod)) {
    const m = exported as Partial<GameModule> | null;
    if (m && typeof m.component === "function") return m.component as FC<GameProps>;
  }
  return null;
}

export const registry: Record<string, GameModule> = {};

for (const [manifestKey, meta] of Object.entries(manifests)) {
  const dir = dirOf(manifestKey);
  const shape = typeof meta?.shape === "string" ? meta.shape : null;
  if (!shape) continue; // a manifest with no shape can't register a game

  const engine = engines[`${dir}engine.ts`];
  const loader = moduleLoaders[`${dir}module.ts`];
  if (typeof engine?.validate !== "function" || !loader) continue; // not a playable archetype yet

  const label = typeof meta.label === "string" ? meta.label : shape;
  const validate = engine.validate.bind(engine) as GameModule["validate"];

  // Deferred component. If the render layer is missing/broken, this import rejects and
  // GameHost's <GameErrorBoundary> shows a friendly message — the rest of the app stays up.
  const component = lazy(async () => {
    const mod = await loader();
    const comp = pickComponent(mod);
    if (!comp) throw new Error(`archetype "${shape}" (${dir}module.ts) exports no GameModule component`);
    return { default: comp };
  });

  // Cast: React.lazy yields a LazyExoticComponent, which renders as JSX exactly like an FC
  // (GameHost wraps it in <Suspense>) but isn't structurally an FC. The contract stays FC.
  registry[shape] = { shape, label, component: component as unknown as FC<GameProps>, validate };
}

export function getModule(shape: string): GameModule | undefined {
  return registry[shape];
}
