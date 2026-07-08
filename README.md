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

**And you can author your own.** Hit **＋ New Topic**, type any concept, and Claude Code picks the archetype
whose shape fits and authors a whole validated game from scratch — **sizing the curriculum to the concept**
(it decides how many levels the idea needs, not a fixed count). The bundled `🏛️ How a Bill Becomes a Law`
domain was authored this way, live, from the bare phrase.

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
    registry.ts                # shape -> archetype (add a game = add a line)
    characterDescent/          # archetype #1 (2D/PixiJS): engine.ts + scene.ts + CharacterDescent.tsx + module.ts
    binarySearch/              # archetype #2 (2D/PixiJS): engine.ts + scene.ts + BinarySearch.tsx + module.ts
  shell/                       # fixed engine, archetype-agnostic (unchanged across both archetypes)
    contentLoader.ts           # reads content-as-data at runtime
    progress.ts                # mastery, gap detection, tickets, localStorage
    Map.tsx                    # the ladder + theme switcher
    GameHost.tsx               # validates level data, mounts the archetype
    AuthorQueue.tsx / tickets.ts # the LIVE self-heal author queue (auto-author) + authoring-server client
    TicketModal.tsx            # explains a ticket the moment a gap is flagged
server/                        # the OFFLINE half of the loop (no LLM in the play loop)
  server.mjs                   # ticket queue + /api/tickets/:id/author endpoint
  author.mjs                   # invokes `claude -p` to author a node; deterministic fallback; validates all output
public/content/
  character-descent/           # graph.json + themes/{wizard-well,matryoshka}.json
  binary-search/               # graph.json + themes/{vault-heist,library}.json
schema/graph.schema.json       # what Claude Code authors against
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design decisions and how to add archetype #2.
