// The authoring ORCHESTRATORS: a gap ticket -> one validated node (self-heal), a bare concept
// -> a whole validated game (topic), and a concept that fits no shape -> a brand-new archetype
// (Stage 2). The mechanics they compose live in sibling modules: the `claude -p` CLI
// (claude.mjs), content IO (content.mjs), prompt construction (prompts.mjs), and validation
// (validate.mjs). Primary path: the real Claude CLI. Safety net (self-heal only): a
// deterministic template author, so the loop ALWAYS closes with valid content.

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { lintArchetypeFiles, buildProject, engineSelfTest } from "./archetypeGate.mjs";
import { runClaude, runClaudeStream, parseJson, stripFences } from "./claude.mjs";
import { slug, cap, camel, clone } from "./util.mjs";
import {
  contentDir,
  loadManifests,
  loadRefs,
  loadExample,
  loadArchetypeSource,
  pickExampleNode,
  uniqueId,
  updateDomains,
  nextDomainSlug,
  writeArchetypeFiles,
} from "./content.mjs";
import {
  buildPrompt,
  buildTopicPrompt,
  moduleTemplate,
  pEngine,
  pManifest,
  pGraph,
  pTheme,
  pScene,
  pComponent,
  pStyles,
} from "./prompts.mjs";
import {
  validateGraph,
  validateLevelsForShape,
  validateThemeEntry,
  attachFailureModes,
  normalizeTopic,
} from "./validate.mjs";

// Preserve author.mjs's historical export surface for helpers that now live elsewhere.
export { runClaudeStream, attachFailureModes };

// ============================================================================
// Self-heal: one gap ticket -> one validated, schema-valid "sidequest" node.
// ============================================================================

async function finalize(root, ticket, partial, refs) {
  const { graph } = refs;
  const example = pickExampleNode(graph, ticket.gap);
  const level = partial.node && partial.node.level;
  await validateLevelsForShape(root, graph.shape, [{ label: "authored level", level }]);

  const themes = {};
  for (const tid of graph.themes) {
    const entry = partial.themes && partial.themes[tid];
    validateThemeEntry(graph.shape, entry, level);
    themes[tid] = entry;
  }

  const node = {
    id: uniqueId(`heal-${slug(ticket.gap)}`, graph),
    type: "sidequest",
    concept: ticket.gap,
    tier: example.tier ?? 2,
    prereqs: [],
    hidden: true,
    remediates: example.id,
    clearsGap: ticket.gap,
    shape: graph.shape,
    authored: true,
    level,
    failureModes: [],
  };
  return { node, themes };
}

function normalizeParsed(p) {
  const node = p.node ?? p;
  return { node: { level: node.level ?? p.level }, themes: p.themes ?? {} };
}

async function templateAuthor(root, ticket, refs) {
  const { graph, themes } = refs;
  const src = pickExampleNode(graph, ticket.gap);
  const partial = { node: { level: clone(src.level) }, themes: {} };
  for (const tid of graph.themes) {
    const base = clone(themes[tid].nodes[src.id]);
    partial.themes[tid] = {
      title: `Reinforce · ${cap(ticket.gap)}`,
      hook: `A quick drill to lock in "${ticket.gap}". ${base.hook}`,
      winText: base.winText,
      ...(base.failText ? { failText: base.failText } : {}),
      ...(base.extra ? { extra: base.extra } : {}),
    };
  }
  return finalize(root, ticket, partial, refs);
}

export async function authorNode(ticket, root, { onLog, onText } = {}) {
  const refs = await loadRefs(root, ticket.domain || ticket.shape);
  const manifests = await loadManifests(root);
  if (process.env.CQ_NO_CLAUDE !== "1") {
    try {
      onLog?.(`▸ Asking Claude Code to author a "${ticket.gap}" drill for the ${refs.graph.shape} archetype…`);
      const raw = await runClaudeStream(buildPrompt(ticket, refs, manifests), { onLog, onText }, 120000);
      const authored = await finalize(root, ticket, normalizeParsed(parseJson(raw)), refs);
      onLog?.("✓ Drill validated.");
      return { authored, authoredBy: "claude" };
    } catch (e) {
      onLog?.(`✗ Claude path failed (${String(e && e.message ? e.message : e).slice(0, 120)}) — using deterministic template`);
      console.error("[author] claude path failed, falling back to template:", String(e).slice(0, 300));
    }
  }
  onLog?.("▸ Authoring from the deterministic template…");
  return { authored: await templateAuthor(root, ticket, refs), authoredBy: "template" };
}

export async function applyAuthored(shape, authored, root) {
  const dir = contentDir(root, shape);
  const graphPath = path.join(dir, "graph.json");
  const graph = JSON.parse(await readFile(graphPath, "utf8"));
  if (!graph.nodes.some((n) => n.id === authored.node.id)) {
    graph.nodes.push(authored.node);
    await writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n");
  }
  for (const tid of graph.themes) {
    const tp = path.join(dir, "themes", `${tid}.json`);
    const theme = JSON.parse(await readFile(tp, "utf8"));
    if (!theme.nodes[authored.node.id]) {
      theme.nodes[authored.node.id] = authored.themes[tid];
      await writeFile(tp, JSON.stringify(theme, null, 2) + "\n");
    }
  }
  return authored.node.id;
}

// ============================================================================
// Whole-topic authoring: a bare concept -> a complete, validated, playable game.
// Same claude -> validate -> write pipeline, scaled from one node to a full graph.
// No silent fallback here: if it can't produce a VALID game, it fails loudly.
// ============================================================================

export async function authorTopic(concept, root, { attempts = 2, onLog, onText } = {}) {
  const manifests = await loadManifests(root);
  const shapes = Object.keys(manifests);
  if (!shapes.length) throw new Error("no archetype manifests found under src/archetypes");

  // Route the concept: reuse an existing archetype, or GENERATE a brand-new one when the
  // concept's natural interaction fits none of them. Classification failure (e.g. the CLI
  // is unavailable) falls back to the existing multi-shape author.
  let routing = { fits: shapes[0] };
  if (process.env.CQ_NO_CLAUDE !== "1") {
    try {
      routing = await classifyConcept(concept, manifests, { onLog });
    } catch (e) {
      onLog?.(`(archetype routing skipped: ${String(e && e.message ? e.message : e).slice(0, 100)})`);
    }
  }
  if (!routing.fits) {
    onLog?.(`▸ No existing archetype fits "${concept}" — generating a NEW archetype${routing.newShape ? ` (${routing.newShape})` : ""}.`);
    return await generateArchetype(concept, root, { onLog, onText, hint: routing });
  }
  onLog?.(`▸ "${concept}" fits the "${routing.fits}" archetype — authoring content for it.`);

  let examples;
  try {
    examples = {};
    for (const s of shapes) examples[s] = await loadExample(root, s, manifests);
  } catch {
    throw new Error(`missing reference content for a registered archetype (${shapes.join(", ")})`);
  }
  let lastErr = "";
  for (let i = 0; i < attempts; i += 1) {
    try {
      onLog?.(`▸ Asking Claude Code to classify "${concept}" and author a full game… (attempt ${i + 1})`);
      const text = await runClaudeStream(buildTopicPrompt(concept, examples, manifests, lastErr), { onLog, onText }, 300000);
      onLog?.("▸ Parsing and validating the authored graph…");
      const topic = normalizeTopic(concept, parseJson(text));
      attachFailureModes(topic.shape, topic.graph, manifests);
      await validateGraph(root, topic.shape, topic.graph, topic.themes, manifests);
      onLog?.(`✓ Valid: "${topic.shape}" archetype · ${topic.graph.nodes.length} nodes · acyclic · boss present.`);
      return topic;
    } catch (e) {
      lastErr = String(e && e.message ? e.message : e).slice(0, 300);
      onLog?.(`✗ Attempt ${i + 1} failed validation: ${lastErr}${i + 1 < attempts ? " — retrying" : ""}`);
      console.error(`[topic] attempt ${i + 1}/${attempts} failed: ${lastErr}`);
    }
  }
  throw new Error(`could not author a valid game for "${concept}" (${lastErr})`);
}

export async function applyTopic(concept, topic, root) {
  const s = await nextDomainSlug(root, concept);
  const dir = contentDir(root, s);
  await mkdir(path.join(dir, "themes"), { recursive: true });
  await writeFile(path.join(dir, "graph.json"), JSON.stringify(topic.graph, null, 2) + "\n");
  for (const tid of Object.keys(topic.themes)) {
    const theme = topic.themes[tid];
    theme.id = tid;
    await writeFile(path.join(dir, "themes", `${tid}.json`), JSON.stringify(theme, null, 2) + "\n");
  }
  await updateDomains(root, { slug: s, label: topic.label });
  return s;
}

// ============================================================================
// Stage 2 — on-the-go archetype generation. When a concept fits NO registered
// archetype, Claude Code authors a brand-new one (the island's code + manifest),
// which only becomes live code after passing the gate (lint · build · self-test).
// Play-time stays LLM-free: the result is ordinary bundled code.
// ============================================================================

// Ask Claude whether an existing archetype fits the concept, or a new shape is needed.
export async function classifyConcept(concept, manifests, { onLog } = {}) {
  const shapes = Object.keys(manifests);
  const list = shapes.map((s) => `- "${s}": ${manifests[s].blurb}`).join("\n");
  const prompt = [
    `Route a learning concept to a game ARCHETYPE — the interaction SHAPE a player performs on a 2D canvas.`,
    `CONCEPT: "${concept}"`,
    ``,
    `Existing archetypes:`,
    list,
    ``,
    `Does the concept's CORE interaction genuinely match one of these shapes? Reuse a shape ONLY if the mechanic truly fits; otherwise prefer inventing a new shape.`,
    `Reply with ONLY a JSON object:`,
    `- fits an existing shape → {"fits":"<shape id>"}`,
    `- needs a new shape      → {"fits":null,"newShape":"<kebab-case 2-3 words>","idea":"<one sentence: what the player physically does to solve it>"}`,
  ].join("\n");
  onLog?.(`▸ Classifying "${concept}" against ${shapes.length} archetype(s)…`);
  // Plain text mode: the streaming variant stalls on non-trivial completions in some envs.
  const obj = parseJson(await runClaude(prompt, 120000));
  const fits = obj.fits && shapes.includes(obj.fits) ? obj.fits : null;
  return { fits, newShape: obj.newShape ? slug(obj.newShape) : undefined, idea: obj.idea };
}

// Generate a new archetype for `concept` as SEVEN small single-file model calls (engine,
// manifest, graph, theme, scene, Component, styles) — each fast and reliable, where one
// whole-archetype call times out. Gated in two stages: the pure engine + content are
// validated (lint · engine self-test · content) before the renderer is generated (fail
// fast), then the whole project must typecheck + bundle. On success returns a topic
// {shape, graph, themes, label} for applyTopic. The generated CODE lives in
// src/archetypes/<dir>/ and is rolled back if the attempt fails the gate.
export async function generateArchetype(concept, root, { onLog, attempts = 2, hint } = {}) {
  const ex = await loadArchetypeSource(root);
  const shape = hint?.newShape && /^[a-z][a-z0-9-]*$/.test(hint.newShape) ? hint.newShape : slug(concept) || "concept-game";
  const dir = camel(shape);
  const archDir = path.join(root, "src", "archetypes", dir);
  let lastErr = "";
  for (let i = 0; i < attempts; i += 1) {
    onLog?.(`▸ Generating archetype "${shape}" for "${concept}" (attempt ${i + 1}/${attempts})…`);
    try {
      // 1) engine.ts — the pure correctness core
      onLog?.("▸ [1/7] engine.ts…");
      const engineTs = stripFences(await runClaude(pEngine(concept, ex, shape, hint, lastErr), 240000));
      if (!/export\s+function\s+evaluate\s*\(/.test(engineTs) || !/export\s+function\s+validate\s*\(/.test(engineTs)) {
        throw new Error("engine.ts must export both evaluate() and validate()");
      }
      const wiringProbe = moduleTemplate(shape, shape);
      lintArchetypeFiles({ "engine.ts": engineTs, "module.ts": wiringProbe });

      // 2) manifest (with selfTest) — matched to this engine
      onLog?.("▸ [2/7] manifest…");
      const manifest = parseJson(await runClaude(pManifest(concept, ex, shape, engineTs, lastErr), 180000));
      if (!manifest?.selfTest?.level || !Array.isArray(manifest.selfTest?.cases) || !manifest.selfTest.cases.length) {
        throw new Error("manifest.selfTest { level, cases } is required");
      }
      const label = manifest.label || shape;
      manifest.shape = shape;
      const wiring = moduleTemplate(shape, label);
      await writeArchetypeFiles(archDir, {
        "engine.ts": engineTs,
        "module.ts": wiring,
        "archetype.manifest.json": JSON.stringify(manifest, null, 2) + "\n",
      });
      onLog?.("▸ gate — engine self-test (solvable + emits signals)…");
      await engineSelfTest(root, path.join(archDir, "engine.ts"), manifest.selfTest);

      // 3) graph + 4) theme — the content, validated against the new manifest
      onLog?.("▸ [3/7] graph…");
      const graph = parseJson(await runClaude(pGraph(concept, ex, shape, engineTs, manifest, lastErr), 240000));
      onLog?.("▸ [4/7] theme…");
      const theme = parseJson(await runClaude(pTheme(concept, ex, shape, graph, manifest, lastErr), 180000));
      // Graph and theme were generated in separate calls; force their ids to link (one theme).
      const themeId = theme.id || (Array.isArray(graph.themes) && graph.themes[0]) || "main";
      theme.id = themeId;
      const themes = { [themeId]: theme };
      graph.shape = shape;
      graph.themes = [themeId];
      for (const n of graph.nodes ?? []) n.shape = shape;
      const withNew = { ...(await loadManifests(root)), [shape]: manifest };
      attachFailureModes(shape, graph, withNew);
      await validateGraph(root, shape, graph, themes, withNew);
      onLog?.("✓ core validated (engine solvable · content valid). Generating the renderer…");

      // 5) scene.ts, 6) Component.tsx, 7) styles.css — the PixiJS renderer
      onLog?.("▸ [5/7] scene.ts…");
      const sceneTs = stripFences(await runClaude(pScene(concept, ex, engineTs, lastErr), 300000));
      onLog?.("▸ [6/7] Component.tsx…");
      const componentTsx = stripFences(await runClaude(pComponent(concept, ex, engineTs, sceneTs, lastErr), 300000));
      if (!/export\s+default\s+function/.test(componentTsx)) throw new Error("Component.tsx must export a default function");
      onLog?.("▸ [7/7] styles.css…");
      const stylesCss = stripFences(await runClaude(pStyles(concept, ex, componentTsx, lastErr), 150000));

      const allFiles = {
        "engine.ts": engineTs,
        "scene.ts": sceneTs,
        "Component.tsx": componentTsx,
        "module.ts": wiring,
        "styles.css": stylesCss,
      };
      lintArchetypeFiles(allFiles);
      await writeArchetypeFiles(archDir, allFiles);
      onLog?.("▸ gate — build (whole project typechecks + bundles)…");
      await buildProject(root);

      manifest.exampleDomain = await nextDomainSlug(root, concept);
      await writeFile(path.join(archDir, "archetype.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      onLog?.(`✓ New archetype "${shape}" passed the gate (lint · self-test · build); content valid (${graph.nodes.length} nodes).`);
      return { shape, graph, themes, label };
    } catch (e) {
      lastErr = String(e && e.message ? e.message : e).slice(0, 500);
      onLog?.(`✗ Attempt ${i + 1} rejected: ${lastErr.split("\n")[0]}`);
      await rm(archDir, { recursive: true, force: true }); // roll back generated code
    }
  }
  throw new Error(`could not generate a valid archetype for "${concept}": ${lastErr}`);
}
