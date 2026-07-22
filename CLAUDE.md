# CLAUDE.md — working in Concept Quest

Read this first. It's the map, the rules, and the recipes. Deep rationale lives in
[`ARCHITECTURE.md`](./ARCHITECTURE.md); the product pitch lives in [`README.md`](./README.md).

> **Keep the docs in sync.** These three files (`CLAUDE.md`, `ARCHITECTURE.md`, `README.md`) describe the
> same system. If a change alters the architecture, the archetype/theme inventory, the authoring/self-heal
> flow, the file layout, or anything else those docs state, **update the affected docs in the same change.**
> Stale docs — wrong archetype count, a renamed/removed domain, a feature that no longer works that way —
> are treated as a bug, not a follow-up.

## What this is (in one breath)

Gamify **any** concept into levels. A **fixed engine reads content-as-data**: an `archetype` (a
concept's *shape*, e.g. recursion) renders many `themes` (a concept's *subject*, e.g. wizard's well /
nesting dolls) over ONE structural `graph.json`. Every archetype renders on a **2D PixiJS canvas** (a
`scene.ts` renderer driven by the pure engine) where a character acts out the concept. Claude Code
**authors** content offline (`claude -p`); **no LLM runs at play-time.** Gap detection is deterministic,
from play states.

## Commands

```bash
npm run dev            # play-time app        (Vite; auto-picks a free port, prints its URL)
npm run server         # authoring server     (prefers :8787, scans up if busy; only for New Topic + self-heal)
npm run dev:all        # BOTH on free ports, proxy auto-wired (one command; recommended)
npm run build          # tsc -b && vite build (the CI-style correctness check)
npm run graph          # build/refresh the code graph (graphify; deterministic, idempotent, no LLM)
```

## Architecture map (and the layers you must not cross)

```
src/
  App.tsx                     product shell wiring (nav, domain state) — the ONLY file that
                              touches the registry
  types.ts                    THE contract: GameModule / GameProps / Graph / Theme. The hub.
  shell/                      game-agnostic UI + logic (Map, GameHost, AuthorQueue, Terminal,
                              contentLoader, progress, tickets, authoring). Knows NO specific game.
  archetypes/
    registry.ts               shape -> GameModule. The single wiring point; auto-globs */module.ts.
    characterDescent/         Component.tsx + scene.ts (PixiJS renderer) + engine.ts (pure) + module.ts
                              + archetype.manifest.json (self-describes the offline authoring contract)
    binarySearch/             same layout: Component.tsx + scene.ts + engine.ts + module.ts + manifest
    batchPacking/             same layout — resource/throughput batching (the "why vLLM" shape)
    stateTraversal/           same layout — state + transition (FSM); GENERATED live by claude -p (Stage 2)
public/content/<domain>/      authored data: graph.json + themes/*.json  (NOT code — file drops)
server/                       offline `claude -p` authoring, split by seam: orchestrators (author.mjs)
                              over claude.mjs (CLI) · prompts.mjs · content.mjs (IO) · validate.mjs ·
                              util.mjs; the Stage-2 gate (archetypeGate.mjs); SSE server (server.mjs)
schema/graph.schema.json      JSON Schema for authored graphs
```

**Data flow:** `App` → `contentLoader` loads `public/content/<domain>/graph.json` + a theme →
`getModule(node.shape)` → the archetype's `component` renders behind `GameProps`. A play-state emits
`onSignal(tag)`; `progress.ts` counts signals against `node.failureModes` and surfaces a gap
(existing sidequest node) or a `generate:` ticket to the server.

### HARD RULES (verified to hold today — keep them holding)

1. **The shell never imports archetype internals.** `src/shell/**` imports from `types.ts` only, never
   from `src/archetypes/**`. (An archetype is reached indirectly, via the registry, from `App`.)
2. **Archetypes never import each other.** `characterDescent/**` and `binarySearch/**` are islands.
3. **Only `App.tsx` touches the registry.** Everything else meets at the `GameModule` contract.
4. **Engines are pure & deterministic.** `archetypes/*/engine.ts` has no React, no I/O, no randomness;
   it computes play results and emits the gap signals. It is the correctness-critical code — keep it unit-testable.
5. **Content is data, not code.** Never hard-code a subject into an archetype. New node/sidequest =
   a file drop under `public/content/`, not a rebuild.

Before finishing a change, sanity-check rules 1–3 with the graph (below) or:
`grep -rn "archetypes/" src/shell/` must return nothing.

## Recipe: add an archetype (the extension primitive)

1. `src/archetypes/<shape>/` — `Component.tsx` (behind `GameProps`) mounting a **PixiJS stage via
   `scene.ts`** (the imperative renderer), pure `engine.ts` (emits signals **and exports `validate`**),
   and a thin `module.ts` re-exporting them as a `GameModule { shape, label, component, validate }`.
   `validate` **guards CC-authored data at the boundary** — throw on malformed input. Keep it in
   `engine.ts`, not `module.ts`: living in the pure island lets the offline authoring server run the
   *same* validator (it transpiles `engine.ts` and calls `validate` in a sandboxed subprocess — see
   `server/archetypeGate.mjs`), so there is **no per-shape validation to hard-code server-side**. Keep
   `engine.ts` free of React/Pixi — the scene only *draws* the engine's output, so the correctness-critical
   logic stays pure and testable.
2. **No registry edit** — `registry.ts` auto-discovers `src/archetypes/*/module.ts` via `import.meta.glob`.
   Instead, drop an `archetype.manifest.json` beside `module.ts` so the offline author can classify concepts
   onto your shape and author valid `level`/theme data (declares `blurb`, `classify`, `levelFormat`,
   `drillLevelFormat`, `failureModes`, `requiredThemeVocab`, `exampleDomain`). The server reads manifests —
   it no longer hard-codes the shape list.
3. Author `public/content/<domain>/graph.json` + `themes/*.json` (each node's `shape` = your new shape).
   This doubles as the manifest's `exampleDomain` — the reference the author copies structure from.

The map, progress, gap engine, tickets, and theming stay untouched. Archetype-specific per-node theme
data rides in `ThemeNode.extra` (the shell ignores it; your archetype interprets it).

## Recipe: add a theme (same graph, new subject)

Drop `public/content/<domain>/themes/<name>.json` implementing `Theme` — one `ThemeNode` per graph
node. No code changes. This is the core bet: one engine + one graph teaches a different subject.

## Navigating the code graph (graphify)

A deterministic code graph (AST, ~40 langs, zero tokens) answers structural questions faster than
grepping. Build/refresh it with `npm run graph` (idempotent; also writes `GRAPH_REPORT.md` +
`graph.html`), then query `graphify-out/graph.json`:

```bash
graphify affected "types.ts"          # every file impacted by a contract change (checks the hub)
graphify path "App.tsx" "registry.ts" # how one file reaches another
graphify query "how does the shell load content?"
graphify explain "GameHost.tsx"
```

Install (once, host-level): `uv tool install graphifyy` (cmd is `graphify`; PyPI pkg is `graphifyy`).
The graph is git-ignored and regenerates for free — never commit `graphify-out/`. `.graphifyignore`
keeps docs/lockfile/generated dirs out of it.

## Gotchas

- **Authoring is offline & opt-in.** The browser never calls an LLM. `New Topic` / self-heal need
  `npm run server` running; the game plays fully without it.
- **Authored topics ship empty `failureModes`** → the self-heal loop doesn't fire on them yet.
- **`node_modules`, `dist`, `vite.config.js/.d.ts`, tsbuildinfo are symlinks** to a sibling checkout —
  don't be surprised; they're git-ignored build artifacts.
- After nontrivial changes, run `npm run build` (it typechecks the whole project) and, for UI, the
  `test-ui` skill.

## graphify (auto-generated)

A deterministic code graph lives at `graphify-out/` (build it with `npm run graph`; it's git-ignored).

Guidance (a nudge, not a mandate — this is a small repo, reading files directly is fine):
- For **architecture / how-does-X-connect** questions, prefer `graphify query "<question>"`,
  `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` — they return a scoped subgraph,
  usually smaller than raw grep output. Grep/read directly for specific strings or when editing.
- Read `graphify-out/GRAPH_REPORT.md` for a broad architecture overview.
- After changing code, run `npm run graph` (`graphify update .`) to keep the graph current (AST-only, no API cost).
