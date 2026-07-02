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
- **Self-heal loop.** A crossed gap threshold routes to an existing `sidequest:<id>` (instant) or emits a
  `generate:<spec>` **ticket** for Claude Code (async). The "I don't get this" button is the manual hatch.

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
- Ticket generation is simulated (the modal) — wiring it to a real Claude Code kanban run is the next step.
