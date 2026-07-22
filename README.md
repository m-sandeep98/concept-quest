# Concept Quest

Gamify **any** concept into levels. A fixed game engine reads content-as-data; a library of
themeable **game archetypes** turns concepts into things you *play*, not quizzes you answer.
Claude Code is the authoring engine (offline); no LLM runs while you play.

This repo is a **vertical slice** with **four archetypes**, each rendered on a 2D **PixiJS** stage where a
character acts out the concept. Most run two subjects on the exact same engine and the same structural graph:

- 🌀 **Recursive Descent** (shape: self-similar nesting) — 🧙 *Wizard's Well* (recursion in code) & 🪆 *Nesting Dolls* (no code)
- 🔍 **Binary Search** (shape: search by halving) — 🗝️ *Vault Heist* (code) & 📚 *Sorted Shelf* (books on a shelf)
- 🧩 **Batch Packing** (shape: resource/throughput batching) — ⚡ *vLLM on a GPU* (inference throughput) & 🥖 *Batch Bakery* (oven throughput)
- 🎛️ **State Traversal** (shape: state + transition) — *Finite State Machine* — this archetype was **generated live** by Claude Code (see below)

Switch archetypes and subjects in the app to watch one mechanic teach different subjects, and several
mechanics share one shell. That's the whole bet: **archetype = a concept's *shape*; theme = its *subject*.**

**And you can author your own.** Hit **＋ New Topic**, type any concept, and Claude Code picks the archetype
whose shape fits — or, when no existing shape fits, **generates a brand-new archetype** (its pure engine +
PixiJS renderer + manifest, gated by lint · build · self-test) — then authors a whole validated game from
scratch, **sizing the curriculum to the concept** (it decides how many levels the idea needs, not a fixed
count). The bundled `🎛️ How a Finite State Machine Works` domain was authored this way, live, from the bare
phrase.

Each authored game also suggests a few **Deeper dives** — related subtopics you can turn into their own
sub-game with one click (**✨ Generate sub-game**), nested under the parent topic in the sidebar.

## Run it

```bash
npm install
npm run dev      # play-time app  → http://localhost:5173
npm run server   # 2nd terminal   → authoring server on :8787 (enables authoring: new topics + self-heal)
```

Topics live in the **left sidebar** (＋ New Topic to author one). The **bottom dock** has an **Author
Queue** and a live **Claude Terminal** that streams `claude -p` as it authors; the game **auto-reloads**
when a run finishes. The game plays fully without the server — only authoring needs it. Build check:
`npm run build`.

## Using Claude Code — the one policy rule

Authoring runs `claude -p` **headlessly on your own machine and your own Claude account** — a fully
supported use of Claude Code. The hard limit: **if you productize this, you may not serve many
end-users through a single developer account.** Each user must authenticate with their **own** Claude
account (OAuth) or API key; OAuth tokens are restricted to Claude Code / claude.ai and can't be
repurposed. See Anthropic's [Usage Policy](https://www.anthropic.com/legal/aup) and
[Commercial Terms](https://www.anthropic.com/legal/commercial-terms).

## Play the loop

1. Climb the ladder from the base (return value → base case → recursive case → **BOSS**).
2. In each level you **build a rule from blocks** (a STOP / base case + a DESCEND / recursive step),
   hit run, and **watch it execute** — the well nests deeper, the call stack grows, then it unwinds.
3. Forget the STOP and you literally fall forever → `STACK OVERFLOW`. Make the same mistake twice and
   the engine flags a **gap** (deterministically, from the play state) and surfaces the **Bottomless
   Pit** sidequest — or emits a **Claude Code ticket** to author new remediation.
4. Stuck on something we didn't anticipate? Hit **“I don't get this”** → manual ticket.

## How it's built

```
src/
  types.ts                     # the GameModule contract + content-graph types
  archetypes/
    registry.ts                # shape -> archetype; auto-discovers */module.ts (no edit to add one)
    characterDescent/          # recursion (2D/PixiJS): engine.ts + scene.ts + CharacterDescent.tsx + module.ts + manifest
    binarySearch/              # binary search — same layout
    batchPacking/              # resource/throughput batching — same layout
    stateTraversal/            # generated live by Claude Code — same layout (Component.tsx + styles.css)
  shell/                       # fixed engine, archetype-agnostic (unchanged across every archetype)
    contentLoader.ts           # reads content-as-data at runtime
    progress.ts                # mastery, gap detection, tickets, localStorage
    Map.tsx                    # the ladder + theme switcher
    GameHost.tsx               # validates level data, mounts the archetype
    AuthorQueue.tsx / tickets.ts # the LIVE self-heal author queue (auto-author) + authoring-server client
    TicketModal.tsx            # explains a ticket the moment a gap is flagged
server/                        # the OFFLINE half of the loop (no LLM in the play loop)
  server.mjs                   # ticket queue + topic/heal authoring endpoints (SSE stream)
  author.mjs                   # invokes `claude -p` to author a node/topic/archetype; deterministic fallback; validates all output
  archetypeGate.mjs            # lint · build · self-test gate for generated archetypes
public/content/
  character-descent/           # graph.json + themes/{wizard-well,matryoshka}.json
  binary-search/               # graph.json + themes/{vault-heist,library}.json
  batch-packing/               # graph.json + themes/{gpu-vllm,kitchen}.json
  how-a-finite-state-machine-works/  # graph.json + themes/fsm-basics.json (authored live)
schema/graph.schema.json       # what Claude Code authors against
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design decisions and how to add archetype #2.

## License

Released under the [MIT License](./LICENSE) — © 2026 Sandeep Mishra.
