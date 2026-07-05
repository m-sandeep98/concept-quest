---
name: test-ui
description: Drive Concept Quest's UI end-to-end in a real browser with Playwright — verify the map, topic sidebar, playing a level, gaps→kanban, the agent dock, theme switching, and (optionally) live topic authoring. Use before committing UI changes, or when asked to verify/screenshot the app.
---

# Test the Concept Quest UI (Playwright)

Confirms the app renders and the key flows work in a real browser, using the Playwright MCP browser tools. Screenshots are the deliverable for visual review.

## 1. Start the app (both servers)

The UI needs the dev server; authoring flows also need the authoring server. From the repo root (`concept-quest/`), run each in the background:

```bash
npm run server     # authoring server → :8787
npm run dev        # app → :5173 (note the port Vite prints)
```

Wait until the app responds before navigating:

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:5173      # expect 200
curl -s http://localhost:8787/api/health                          # expect {"ok":true}
```

Kill both servers when finished.

## 2. Smoke test (always run this)

1. `browser_navigate` → `http://localhost:5173`.
2. `browser_snapshot` — confirm the structure is present:
   - header **"Concept Quest"** + the **🔒 uses your local Claude account** note,
   - **Topics** sidebar with tabs (🌀 Recursion, 📋 Sequence…, and any authored topics) plus **＋ New Topic**,
   - the level **map** with the boss card on top and an active (unlocked) starting level,
   - the bottom **dock** with **🎫 Kanban** and **🖥️ Claude Terminal** tabs.
3. `browser_console_messages` — assert there are **no error-level messages**. A red error means something is broken; investigate before continuing.
4. `browser_take_screenshot` (fullPage) → attach for visual review.

## 3. Play a level (core gameplay)

**Sequence topic** (Sequence / Process, or an authored topic like the bill/water-cycle):
- Click the topic tab, then an active level card.
- The tray shows scrambled step cards. Click them into a valid dependency order, then click the run button ("Serve it 🍰" / "Ship it 🚀" / etc.).
- Assert the win text shows and **Continue** returns to the map with the node badged **✓ mastered**.
- Gap path: on the boss, deliberately place a step before its prerequisite and run **twice** → confirm a ticket appears in the Kanban **Backlog**.

**Recursion topic** (Wizard's Well / Nesting Dolls):
- Open the **base case** level, click the STOP block into slot ①, run → assert the win + the well reaching the core.
- Omit STOP and run twice → assert **STACK OVERFLOW** (the well shakes) and a gap flag.

## 4. The agent dock

- **🎫 Kanban** tab → columns Backlog / Authoring / Done; a seeded/real ticket has an **⚙ Author with Claude Code** button.
- **🖥️ Claude Terminal** tab → idle message when nothing is running.

## 5. Live authoring (SLOW — only when explicitly verifying authoring)

`claude -p` runs cost tokens and take ~1 min. Do NOT run in a quick smoke test.
- Click **＋ New Topic**, type e.g. `the water cycle`, click **Author game →**.
- The dock switches to the **Claude Terminal**; assert `log` lines stream (classify → validate → write) and Claude's tokens appear.
- On completion the new topic appears in the sidebar and **auto-loads**. `browser_wait_for` the new tab text (allow ~120s).

## 6. Theme + responsive
- On a two-theme topic, click a theme button in the map toolbar → labels/vocab change, structure stays. Screenshot both.
- `browser_resize` to ~700×900 → sidebar stacks above the map, kanban columns collapse to one; screenshot.

## Notes
- Use `browser_snapshot` to find elements (accessibility tree with refs); click via refs.
- Take a screenshot at each major state — that's what gets reviewed.
- Tear down: `browser_close`, then kill the dev + authoring servers.
