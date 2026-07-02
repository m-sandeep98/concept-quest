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
| self-similar / nesting | **recursive-descent** (built) | recursion, fractals, nested stories, taxonomy |
| sequence / process | **sequence** (built) | build pipelines, recipes, history, an algorithm |
| cause → effect | chain/graph builder | causation, ecosystems |
| classify / group | sorting arena | taxonomy, parts of speech |
| trade-off / resource | balance | economics, ecology |
| state + transition | board of states | phases of matter, grammar tense |

~8–12 archetypes, each re-themeable, cover most of general knowledge. **`recursive-descent` ships with
two themes over ONE `graph.json`** to prove it: `wizard-well` (code) and `matryoshka` (no code).
(Honest caveat: nesting is one of the *rarer* shapes; sequence / cause / classify will carry more topics.)

## 4. Fixed engine + content-as-data + deterministic gaps

- **Claude Code authors, never plays.** It writes `graph.json` + theme skins. The engine reads them at
  runtime (`public/content/…`), so adding a node/sidequest is a **file drop, not a rebuild** — which is
  what keeps self-healing cheap.
- **Gap detection is deterministic (option a).** No runtime LLM. Signals come from **play states**: the
  engine's pure `run()` detects `missing-base-case` (no stop → overflow) and `no-progress` (never shrinks
  → overflow). `failureModes` maps a signal → gap → remediation. This is the correctness-critical field.
- **Self-heal loop (wired for real).** A crossed gap threshold routes to an existing `sidequest:<id>`
  (instant) or emits a `generate:<spec>` **ticket** to the local authoring server (`server/`). On a
  kanban board (Backlog → Authoring → Done) you hit "Author with Claude Code" — or flip **Auto-author**
  to drain the backlog one ticket at a time — which invokes `claude -p` headlessly to author a new sidequest node
  (structure + a theme entry per subject); the server **validates** it (solvable level, acyclic deps,
  every step labelled) and writes it into `content/<shape>/`. The app re-reads the graph and the new
  node appears, surfaced. If the model output is missing/malformed, a deterministic template author
  clones a known-valid node so the loop always closes. The "I don't get this" button is the manual hatch.
  The browser never calls an LLM — authoring is strictly offline.

## 5. Whole-topic authoring — gamify anything

The self-heal loop authors *one node*; the same pipeline, scaled up, authors a *whole domain* from a bare
concept. `POST /api/topics {concept}` → Claude Code (`claude -p`) classifies the concept's shape, picks a
registered archetype, and authors a full graph + theme. The server **validates the entire graph** (≥3
nodes, one boss, a root with no prereqs, acyclic prereqs, every node valid for its archetype, theme covers
every node) and **retries with the validation error fed back** if it's wrong — no silent bad content. It
writes `content/<slug>/` and appends to `content/domains.json`; the app picks up the new playable domain.

A **domain** (a content folder) is decoupled from its **archetype** (the `shape` that renders it), so a
topic like `how-a-bill-becomes-a-law` uses the `sequence` archetype without being named after it. Heal
tickets carry both `domain` (where to write) and `shape` (how to author).

**Proof:** `how-a-bill-becomes-a-law` was authored live from the bare phrase in ~100s — a faithful bicameral
DAG (draft → introduce → both chambers in parallel → President signs) — and is kept as a committed artifact.

Limits: authored topics currently ship with empty `failureModes` (so the self-heal loop doesn't fire on them
yet); authoring is a ~1-2 min `claude -p` call and only targets the two existing archetypes, so a concept
that fits neither shape won't author well (which is what motivates archetypes #3+).

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
   deterministic, emits the signals), and a `module.ts` exporting a `GameModule`.
2. Register one line in `src/archetypes/registry.ts`.
3. Author `public/content/timeline/graph.json` + theme skins.

The map, progress, gap engine, tickets, and theming are untouched. Each archetype may render however it
needs (DOM/SVG/Canvas/Phaser) behind the same contract.

### What adding archetype #2 (`sequence`) actually cost

Building a genuinely different second game (order steps into a valid dependency order; a step run before
its prerequisite visibly breaks) was the real test of the contract. The result:

- **Shell logic files unchanged** — `Map`, `GameHost`, `progress`, `contentLoader` didn't move.
- **One additive contract change** — `ThemeNode.extra` (a per-node bag) so a theme can carry
  archetype-specific data (here: step labels). Recursion-specific `visual` fields became optional.
- **One app-level addition** — a domain picker in `App.tsx` so you can navigate between archetypes.
  That's product navigation, not the archetype contract.
- Same proof repeated: `sequence` ships **two subjects over one `graph.json`** — *Ship It* (a build
  pipeline) and *Bake a Cake* (a recipe) share the identical dependency DAG per node. Gap signals
  (`wrong-start`, `dependency-violation`) come from play states; both engines are unit-tested.

## Known limits of this slice

- Rule/step order rules are light (recursion checks the base case first regardless of block order); fine for v1.
- Two archetypes so far — enough to prove the contract generalizes across *shapes*, not just themes.
- The self-heal loop runs on a kanban board (Backlog → Authoring → Done) with an Auto-author toggle;
  it's dev-only (needs `npm run server`) and authors one ticket at a time to avoid content-file races.
  `heal-recursive-case` in the recursion content was authored live by `claude -p` through this loop.
