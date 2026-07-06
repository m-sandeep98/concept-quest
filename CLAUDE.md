# CLAUDE.md — working in Concept Quest

Read this first. It's the map, the rules, and the recipes. Deep rationale lives in
[`ARCHITECTURE.md`](./ARCHITECTURE.md); the product pitch lives in [`README.md`](./README.md).

## What this is (in one breath)

Gamify **any** concept into levels. A **fixed engine reads content-as-data**: an `archetype` (a
concept's *shape*, e.g. recursion) renders many `themes` (a concept's *subject*, e.g. wizard's well /
nesting dolls) over ONE structural `graph.json`. Claude Code **authors** content offline (`claude -p`);
**no LLM runs at play-time.** Gap detection is deterministic, from play states.

## Commands

```bash
npm run dev            # play-time app        → http://localhost:5173  (Vite)
npm run server         # authoring server     → :8787  (needed only for New Topic + self-heal)
npm run build          # tsc -b && vite build (the CI-style correctness check)
npm run graph          # build/refresh the code graph (graphify; deterministic, idempotent, no LLM)
```

## Architecture map (and the layers you must not cross)

```
src/
  App.tsx                     product shell wiring (nav, domain state) — the ONLY file that
                              touches the registry
  types.ts                    THE contract: GameModule / GameProps / Graph / Theme. The hub.
  shell/                      game-agnostic UI + logic (Map, GameHost, Kanban, Terminal,
                              contentLoader, progress, tickets, authoring). Knows NO specific game.
  archetypes/
    registry.ts               shape -> GameModule. The single wiring point.
    recursiveDescent/         Component.tsx + engine.ts (pure) + module.ts (GameModule)
    sequence/                 Component.tsx + engine.ts (pure) + module.ts (GameModule)
public/content/<domain>/      authored data: graph.json + themes/*.json  (NOT code — file drops)
server/                       offline `claude -p` authoring (author.mjs) + SSE server (server.mjs)
schema/graph.schema.json      JSON Schema for authored graphs
```

**Data flow:** `App` → `contentLoader` loads `public/content/<domain>/graph.json` + a theme →
`getModule(node.shape)` → the archetype's `component` renders behind `GameProps`. A play-state emits
`onSignal(tag)`; `progress.ts` counts signals against `node.failureModes` and surfaces a gap
(existing sidequest node) or a `generate:` ticket to the server.

### HARD RULES (verified to hold today — keep them holding)

1. **The shell never imports archetype internals.** `src/shell/**` imports from `types.ts` only, never
   from `src/archetypes/**`. (An archetype is reached indirectly, via the registry, from `App`.)
2. **Archetypes never import each other.** `recursiveDescent/**` and `sequence/**` are islands.
3. **Only `App.tsx` touches the registry.** Everything else meets at the `GameModule` contract.
4. **Engines are pure & deterministic.** `archetypes/*/engine.ts` has no React, no I/O, no randomness;
   it computes play results and emits the gap signals. It is the correctness-critical code — keep it unit-testable.
5. **Content is data, not code.** Never hard-code a subject into an archetype. New node/sidequest =
   a file drop under `public/content/`, not a rebuild.

Before finishing a change, sanity-check rules 1–3 with the graph (below) or:
`grep -rn "archetypes/" src/shell/` must return nothing.

## Recipe: add an archetype (the extension primitive)

1. `src/archetypes/<shape>/` — `Component.tsx` (behind `GameProps`), pure `engine.ts` (emits signals),
   `module.ts` exporting a `GameModule { shape, label, component, validate }`.
   `validate` **guards CC-authored data at the boundary** — throw on malformed input.
2. Register **one line** in `src/archetypes/registry.ts`.
3. Author `public/content/<domain>/graph.json` + `themes/*.json` (each node's `shape` = your new shape).

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
