# Architecture & decisions

The design questions we worked through, and where each landed.

## 1. Top-down or bottom-up?

Neither, exclusively. Split into three axes:

- **Motivation is top-down** — the boss/peak is shown first (the `spine`, boss tier rendered on top).
- **Mastery is bottom-up** — each node's `prereqs` gate the next (the ladder).
- **Gaps are just-in-time** — a weakness surfaces remediation on demand (sidequests / tickets).

## 2. The mechanic must *be* the concept

Early attempt was multiple-choice "levels" — a coding lab, the shallow version of "gamify". Dropped it.
A teaching game embodies the idea in its **rule**: in Recursive Descent you *do* recursion (build a
base case + a shrinking step, run it, watch it overflow if you forget the stop). The failure is felt,
not described.

## 3. Works for ANY concept → archetype (shape) vs theme (subject)

The scalability bet. An archetype is keyed to a concept's **shape**, not its subject:

| Shape | Archetype | Subjects |
|---|---|---|
| self-similar / nesting | **character-descent** (built, 2D) | recursion, fractals, nested stories, taxonomy |
| search / lookup by halving | **binary-search** (built, 2D) | dictionary lookup, guessing games, divide-and-conquer |
| trade-off / resource / throughput | **batch-packing** (built, 2D) | GPU inference batching, oven throughput, scheduling |
| state + transition | **state-traversal** (built, 2D — generated live) | finite state machines, grammar tense, phases of matter |
| sequence / process | sequence arena *(planned)* | build pipelines, recipes, history, an algorithm |
| cause → effect | chain/graph builder *(planned)* | causation, ecosystems |
| classify / group | sorting arena *(planned)* | taxonomy, parts of speech |

~8–12 archetypes, each re-themeable, cover most of general knowledge. **Four ship today**, each proving the
shape/theme split over ONE `graph.json`: `character-descent` skins as `wizard-well` (code) and `matryoshka`
(no code); `binary-search` as `vault-heist` and `library`; `batch-packing` as `gpu-vllm` and `kitchen`; and
`state-traversal` ships `fsm-basics` (this archetype was **generated live** — see §8). Every archetype renders
on a 2D **PixiJS** stage where a character acts out the concept. (Honest caveat: nesting is one of the
*rarer* shapes.)

## 4. Fixed engine + content-as-data + deterministic gaps

- **Claude Code authors, never plays.** It writes `graph.json` + theme skins. The engine reads them at
  runtime (`public/content/…`), so adding a node/sidequest is a **file drop, not a rebuild** — which is
  what keeps self-healing cheap.
- **Gap detection is deterministic (option a).** No runtime LLM. Signals come from **play states**: the
  engine's pure `run()` detects `missing-base-case` (no stop → overflow) and `no-progress` (never shrinks
  → overflow). `failureModes` maps a signal → gap → remediation. This is the correctness-critical field.
- **Self-heal loop (wired for real).** A crossed gap threshold routes to an existing `sidequest:<id>`
  (instant) or emits a `generate:<spec>` **ticket** to the local authoring server (`server/`). On a
  author queue (Backlog → Authoring → Done) you hit "Author with Claude Code" — or flip **Auto-author**
  to drain the backlog one ticket at a time — which invokes `claude -p` headlessly to author a new sidequest node
  (structure + a theme entry per subject); the server **validates** it — the level through the archetype's
  own `validate()` (transpiled from `engine.ts` and run in a sandboxed subprocess, so there is no per-shape
  check hard-coded server-side), plus acyclic deps and a theme entry per node — and writes it into
  `content/<shape>/`. The app re-reads the graph and the new
  node appears, surfaced. If the model output is missing/malformed, a deterministic template author
  clones a known-valid node so the loop always closes. The "I don't get this" button is the manual hatch.
  The browser never calls an LLM — authoring is strictly offline.

### The learning loop — shell-sequenced beats (frame → play → reveal)

The shell (`GameHost`) wraps the concrete game with optional pedagogy **without touching any archetype**.
Each `ThemeNode` may carry a `learn` block — `{frame?, reveal:{concept?, body, inTheWild?}, insights?}` —
that `GameHost` runs as a small phase machine: an optional **frame** card primes the question, the
archetype then plays exactly as today, and on its win the shell intercepts to show a **reveal** that names
the abstract concept. It's content-as-data (hard rule 5) — all narration is authored per theme node, in the
theme's own language — and it degrades gracefully: un-authored nodes behave exactly as before, no extra
clicks. The pedagogy is deliberate: **productive failure** (the reveal reflects on the gap signals that
actually fired during play), **concreteness fading** (the game is the concrete wizard's well; the reveal
names the abstract recursion), and **just-in-time explanation** (a per-signal `insight` surfaces only when
that gap fired).

## 5. Whole-topic authoring — gamify anything

The self-heal loop authors *one node*; the same pipeline, scaled up, authors a *whole domain* from a bare
concept. `POST /api/topics {concept}` → Claude Code (`claude -p`) classifies the concept's shape, picks a
registered archetype, and authors a full graph + theme. **Claude sizes the curriculum to the concept** —
it decides how many levels the idea genuinely needs (roughly 3 for something atomic, up to ~7 for a rich,
multi-part concept), rather than a fixed count. The server **validates the entire graph** (3–14
nodes, one boss, a root with no prereqs, acyclic prereqs, every node's level passing the archetype's own
`validate()`, theme covers every node) and **retries with the validation error fed back** if it's wrong —
no silent bad content. It
writes `content/<slug>/` and appends to `content/domains.json`; the app picks up the new playable domain.

**Subtopics → sub-games.** In the same call Claude also proposes a few `graph.subtopics`
(`{title, concept, blurb}`) — adjacent/deeper ideas, each spinnable into its *own* separate game. The map
surfaces them as a "Deeper dives" strip: **✨ Generate sub-game** reruns this exact pipeline on that
subtopic's `concept`, tagging the new domain with `parent`+`fromConcept` (so the parent shows **▶ Play**
once made, and the sidebar nests it under its parent). Subtopics are sanitized, never validated-to-throw —
a malformed one can't sink an otherwise-valid topic.

A **domain** (a content folder) is decoupled from its **archetype** (the `shape` that renders it), so a
`binary-search` topic can be themed as a library-shelf search or a vault heist without being named after the
archetype. Heal tickets carry both `domain` (where to write) and `shape` (how to author).

Authoring routes the concept to whichever built archetype's shape fits — `character-descent` (recursion/
nesting), `binary-search` (lookup/search/divide-and-conquer), `batch-packing` (resource/throughput), or
`state-traversal` (state + transition). When **no** existing shape fits, it falls through to on-the-go
archetype generation (§8) rather than forcing a bad fit.

Limits: authored topics currently ship with empty `failureModes` (so the self-heal loop doesn't fire on them
yet), and authoring is a ~1-2 min `claude -p` call (a full archetype generation is longer — seven model calls
plus the build gate).

## 6. Live authoring terminal (SSE)

Both authoring paths stream to a live "Claude terminal" in the app. The server runs
`claude -p --output-format stream-json --verbose --include-partial-messages`, parses the newline-
delimited events (buffer + split on `\n` so events never straddle chunk boundaries), and relays them
over **Server-Sent Events**: token deltas as `text`, pipeline narration (classify → validate → write)
as `log`, and a terminal `done`/`failed`. The browser's `EventSource` renders the stream and
**auto-reloads the affected domain on `done`** — using the completion event, not a file-watcher, so it
never reads half-written content. The UI is a left sidebar of topic tabs + a bottom dock (Author Queue +
terminal), mirroring Vibe-Kanban's board+stream split.

**Policy:** authoring runs on the developer's own local Claude account — a supported headless use of
Claude Code. Productizing to many users requires each user's own account/API key (a single dev account
may not proxy many end-users). See README.

## 7. Doubt chat — a permanent Claude session per topic

The learning loop answers the doubts we *anticipated* (authored `frame`/`reveal` beats) and the gaps the
engine can *detect* (signals → sidequest or ticket). Neither covers "wait, why does that work?" — so the
drawer does: **Ask Claude**, a chat docked to the right edge, available on the map and mid-level.

It is *permanent by session id, not by process.* Claude Code persists sessions to disk, so continuity
needs no resident child: the first turn mints the session (`--session-id <uuid>`, a uuid we own), every
later turn resumes it (`--resume <uuid>`). The conversation therefore survives closing the drawer,
reloading the page, restarting the server, and overnight gaps. `server/chat.mjs` owns the id plus a
*mirror* of the transcript for repainting the UI — the conversational memory lives in the session itself,
which is why old turns are never replayed into the prompt. One thread per topic (`server/chat/<slug>.json`),
because a doubt about recursion isn't a doubt about batching. A resume that fails (pruned or stale
session) mints a fresh one and retries once, so a thread degrades to amnesia rather than to a dead end.

Two deliberate constraints. The tutor is **tool-less** — `--disallowed-tools` denies the filesystem,
shell, and network, so a learner-facing chat can't wander the repo or the web; it explains, it doesn't
act. And its standing role arrives via `--append-system-prompt`: answer inside the theme for intuition,
then name the abstract idea, and *don't hand over the level's solution.* Where the player is standing
(topic, archetype, theme, current level) rides along with every turn, so answers land on the level in
front of them.

The drawer **overlays rather than resizes** — the PixiJS canvas behind it keeps the width its scene was
laid out for, so opening the chat mid-level never reflows the game. This is the third offline seam, and
like the other two it is opt-in: without `npm run server` the drawer says so and the game plays on.

## 8. On-the-go archetype generation (Stage 2)

The registry registers each shape from its `archetype.manifest.json` and lazy-loads the archetype's Pixi
render layer (`module.ts` → `Component.tsx` + `scene.ts`) on demand — so a still-being-generated archetype
is fault-isolated (skipped, never a boot-time crash) rather than taking the whole app down mid-authoring.
Each archetype self-describes its authoring contract in that manifest. So when a concept fits **none** of
the built shapes, Claude Code
authors a brand-new archetype from scratch — its pure `engine.ts`, PixiJS `scene.ts` + `Component.tsx`, CSS,
and manifest — as **seven small single-file model calls** (one whole-archetype call times out locally).

Generated code is trusted only after a **three-stage gate** (`server/archetypeGate.mjs`), cheapest first:

1. **lint** — the files obey the island rules: `engine.ts` imports only `../../types` and is pure (no
   `eval`/`require`/`fetch`/`process`/DOM/clock/randomness); no file reaches into another archetype or the
   shell. The renderer files (`scene.ts`/`Component.tsx`) are scanned for the same dangerous calls, minus the
   DOM/Pixi globals they legitimately use.
2. **build** — the whole TS project still typechecks **and** bundles with the new files in it.
3. **self-test** — the pure engine is solvable and emits its declared gap signals, run headlessly in a
   time-boxed subprocess against the manifest's `selfTest` cases.

Fail any stage and the generated directory is rolled back. Play-time stays LLM-free: a passing archetype is
ordinary bundled code. The shipped `state-traversal` archetype (the finite-state-machine domain) was
generated live through exactly this path.

## The extensibility primitive: the `GameModule` contract

The shell knows nothing about any specific game — only this (`src/types.ts`):

```ts
interface GameModule<L> {
  shape: string;
  component: FC<GameProps<L>>;
  validate: (level: unknown) => L;   // guards CC-authored data at the boundary
}
interface GameProps<L> {
  level: L; theme: Theme; themeNode: ThemeNode;
  onSignal: (tag: string) => void;   // emit a gap signal from a play state
  onComplete: (r: { won: boolean }) => void;
}
```

### To add archetype #2 (e.g. `timeline`)

1. `src/archetypes/timeline/` — a `Timeline.tsx` component behind `GameProps`, an `engine.ts` (pure,
   deterministic, emits the signals **and exports `validate`**), and a thin `module.ts` re-exporting them
   as a `GameModule`. Keeping `validate` in the pure `engine.ts` lets the offline authoring server run the
   *same* boundary check (it transpiles the engine and calls `validate` in a sandboxed subprocess).
2. Drop an `archetype.manifest.json` beside `module.ts` — the registry registers the shape from that manifest
   (no edit to `registry.ts`) and lazy-loads the render layer on play; the offline author reads the manifest to
   classify concepts onto your shape. Until the render layer exists the shape is skipped, and `cq:archetype-guard`
   (in `vite.config.ts`) names the missing file — a dev warning, a failing `vite build`.
3. Author `public/content/timeline/graph.json` + theme skins.

The map, progress, gap engine, tickets, and theming are untouched. Each archetype may render however it
needs (DOM/SVG/Canvas/Phaser) behind the same contract.

### What adding archetype #2 (`binary-search`) actually cost

Building a genuinely different second game (search a sorted row by halving; guessing linearly or off the
wrong half visibly fails) was the real test of the contract. The result:

- **Shell logic files unchanged** — `Map`, `GameHost`, `progress`, `contentLoader` didn't move.
- **One additive contract change** — `ThemeNode.extra` (a per-node bag) so a theme can carry
  archetype-specific data. Recursion-specific `visual` fields became optional.
- **One app-level addition** — a domain picker in `App.tsx` so you can navigate between archetypes.
  That's product navigation, not the archetype contract.
- Same proof repeated: `binary-search` ships **two subjects over one `graph.json`** — *Vault Heist* (code)
  and *Sorted Shelf* (books) share the identical structural graph per node, and gap signals come from play
  states. Archetypes #3–#4 (`batch-packing`, then the live-generated `state-traversal`) pushed the same
  contract further without touching the shell.

## Known limits of this slice

- Rule/step order rules are light (recursion checks the base case first regardless of block order); fine for v1.
- Four archetypes so far (one of them generated live) — enough to prove the contract generalizes across
  *shapes*, not just themes.
- The pure engines are written to be unit-testable, but an automated test suite / CI isn't wired up yet.
- The self-heal loop runs on an author queue (Backlog → Authoring → Done) with an Auto-author toggle;
  it's dev-only (needs `npm run server`) and authors one ticket at a time to avoid content-file races.
  `heal-recursive-case` in the recursion content was authored live by `claude -p` through this loop.
