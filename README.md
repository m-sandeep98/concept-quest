# Concept Quest

Gamify **any** concept into levels. A fixed game engine reads content-as-data; a library of
themeable **game archetypes** turns concepts into things you *play*, not quizzes you answer.
Claude Code is the authoring engine (offline); no LLM runs while you play.

This repo is a **vertical slice** with **two archetypes**, each running two subjects on the exact
same engine and the same structural graph:

- 🌀 **Recursive Descent** (shape: self-similar nesting) — 🧙 *Wizard's Well* (recursion in code) & 🪆 *Nesting Dolls* (no code)
- 📋 **Sequence / Process** (shape: ordering + dependencies) — 🚀 *Ship It* (a build pipeline) & 🎂 *Bake a Cake* (a recipe)

Switch archetypes (top) and subjects (theme buttons) in the app to watch one mechanic teach different
subjects, and two mechanics share one shell. That's the whole bet: **archetype = a concept's *shape*;
theme = its *subject*.**

## Run it

```bash
npm install
npm run dev      # play-time app  → http://localhost:5173
npm run server   # 2nd terminal   → authoring server on :8787 (enables the LIVE self-heal loop)
```

The game plays fully without the server; the server is only needed for the self-heal loop
(authoring new content). Build check: `npm run build`.

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
    recursiveDescent/          # archetype #1: engine.ts + RecursiveDescent.tsx + module.ts
    sequence/                  # archetype #2: engine.ts + Sequence.tsx + module.ts + sequence.css
  shell/                       # fixed engine, archetype-agnostic (unchanged across both archetypes)
    contentLoader.ts           # reads content-as-data at runtime
    progress.ts                # mastery, gap detection, tickets, localStorage
    Map.tsx                    # the ladder + theme switcher
    GameHost.tsx               # validates level data, mounts the archetype
    Kanban.tsx / tickets.ts    # the LIVE self-heal kanban (auto-author) + authoring-server client
    TicketModal.tsx            # explains a ticket the moment a gap is flagged
server/                        # the OFFLINE half of the loop (no LLM in the play loop)
  server.mjs                   # ticket queue + /api/tickets/:id/author endpoint
  author.mjs                   # invokes `claude -p` to author a node; deterministic fallback; validates all output
public/content/
  recursive-descent/           # graph.json + themes/{wizard-well,matryoshka}.json
  sequence/                    # graph.json + themes/{ship-it,bake-a-cake}.json
schema/graph.schema.json       # what Claude Code authors against
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design decisions and how to add archetype #2.
