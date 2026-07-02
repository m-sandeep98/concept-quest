# Concept Quest

Gamify **any** concept into levels. A fixed game engine reads content-as-data; a library of
themeable **game archetypes** turns concepts into things you *play*, not quizzes you answer.
Claude Code is the authoring engine (offline); no LLM runs while you play.

This repo is a **vertical slice**: one archetype (`recursive-descent`) running two subjects on the
exact same engine and the same structural graph —

- 🧙 **The Wizard's Well** — recursion, in code
- 🪆 **The Nesting Dolls** — recursion, with no code at all

Switch between them in the app to see one mechanic teach two different subjects. That's the whole
bet: **archetype = a concept's *shape*; theme = its *subject*.**

## Run it

```bash
npm install
npm run dev      # open the printed http://localhost:5173
```

Build check: `npm run build`.

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
    registry.ts                # shape -> archetype (add a game = add a line)
    recursiveDescent/
      engine.ts                # pure, deterministic recursion executor + failure detection
      RecursiveDescent.tsx     # the playable game (build rule → run → animate)
      module.ts                # GameModule: validate() + component
  shell/                       # fixed engine, archetype-agnostic
    contentLoader.ts           # reads content-as-data at runtime
    progress.ts                # mastery, gap detection, tickets, localStorage
    Map.tsx                    # the ladder + theme switcher + ticket queue
    GameHost.tsx               # validates level data, mounts the archetype
    TicketModal.tsx            # the self-heal ticket demo
public/content/recursive-descent/
  graph.json                   # ONE theme-neutral structural graph
  themes/wizard-well.json      # skin #1 (code)
  themes/matryoshka.json       # skin #2 (no code)
schema/graph.schema.json       # what Claude Code authors against
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design decisions and how to add archetype #2.
