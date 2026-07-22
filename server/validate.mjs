// Validation + normalization for authored content: topological soundness, theme entries,
// per-node levels (against each archetype's own engine.validate()), whole-graph structure,
// deterministic failure-mode attachment, and shape/label normalization. Guards ALL authored
// content — model-generated or template — before it is written.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateLevelsWithEngine } from "./archetypeGate.mjs";
import { archetypesDir } from "./content.mjs";
import { slug, camel, titleCase } from "./util.mjs";

function topoOrThrow(steps) {
  const indeg = new Map(steps.map((s) => [s.id, 0]));
  const adj = new Map(steps.map((s) => [s.id, []]));
  for (const s of steps) {
    for (const n of s.needs || []) {
      adj.get(n).push(s.id);
      indeg.set(s.id, indeg.get(s.id) + 1);
    }
  }
  const q = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  let seen = 0;
  while (q.length) {
    const id = q.shift();
    seen += 1;
    for (const m of adj.get(id)) {
      indeg.set(m, indeg.get(m) - 1);
      if (indeg.get(m) === 0) q.push(m);
    }
  }
  if (seen !== steps.length) throw new Error("dependency cycle in steps");
}

// Validate authored levels for a shape against the ARCHETYPE'S OWN validate() (exported from
// its engine.ts) — the exact guard the browser runs at the GameModule boundary. Replaces a
// hard-coded per-shape switch: every archetype self-describes its level contract, so adding
// one needs no edits here (HARD RULE — only App touches the registry; the server reads
// manifests/engines). A shape whose engine exposes no validate() falls back to a presence
// check. `items`: [{ label, level }]; the label names the offending node in any error.
export async function validateLevelsForShape(root, shape, items) {
  const engineTs = path.join(archetypesDir(root), camel(shape), "engine.ts");
  let src = "";
  try {
    src = await readFile(engineTs, "utf8");
  } catch {
    /* no engine on disk for this shape */
  }
  const exportsValidate =
    /export\s+(?:async\s+)?function\s+validate\b/.test(src) || /export\s*\{[^}]*\bvalidate\b[^}]*\}/.test(src);
  if (!exportsValidate) {
    for (const { label, level } of items) {
      if (!level || typeof level !== "object") throw new Error(`${label}: shape "${shape}" level must be an object`);
    }
    return;
  }
  try {
    await validateLevelsWithEngine(root, engineTs, items.map((it) => it.level));
  } catch (e) {
    const m = /^(\d+)\t([\s\S]*)$/.exec(String(e && e.message ? e.message : e));
    if (m) {
      const item = items[Number(m[1])];
      throw new Error(`${item ? item.label : `level ${m[1]}`}: ${m[2]}`);
    }
    throw e;
  }
}

export function validateThemeEntry(shape, e, _level) {
  if (!e || typeof e.title !== "string" || typeof e.hook !== "string" || typeof e.winText !== "string") {
    throw new Error("theme entry needs title, hook, winText");
  }
  // The builtin archetypes theme purely through the node's title/hook/winText/failText
  // plus the theme-level vocab/visual — there is no per-node `extra` payload to validate.
  // An archetype that needs `extra` validates it in its own module.validate() boundary.
}

export async function validateGraph(root, shape, graph, themes, manifests) {
  if (!manifests?.[shape]) throw new Error(`unknown shape "${shape}" (no registered archetype manifest)`);
  if (!Array.isArray(graph.nodes) || graph.nodes.length < 3) throw new Error("need >= 3 nodes");
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (ids.size !== graph.nodes.length) throw new Error("duplicate node ids");
  let hasBoss = false;
  let hasRoot = false;
  for (const n of graph.nodes) {
    if (!n.id || !n.concept || typeof n.tier !== "number") throw new Error(`node ${n.id || "?"} missing id/concept/tier`);
    if (!["level", "boss", "sidequest"].includes(n.type)) throw new Error(`node ${n.id} bad type`);
    if (n.type === "boss") hasBoss = true;
    const prereqs = n.prereqs ?? [];
    for (const p of prereqs) if (!ids.has(p)) throw new Error(`node ${n.id} prereq "${p}" missing`);
    if (prereqs.length === 0 && n.type !== "sidequest") hasRoot = true;
    for (const fm of n.failureModes ?? []) {
      if (!fm.signal || !fm.gap || !fm.remediation) throw new Error(`node ${n.id} bad failureMode`);
      const [kind, target] = String(fm.remediation).split(":");
      if (kind === "sidequest" && !ids.has(target)) throw new Error(`remediation sidequest "${target}" missing`);
    }
  }
  if (!hasBoss) throw new Error("need a boss node");
  if (!hasRoot) throw new Error("need a starting level (prereqs [])");
  topoOrThrow(graph.nodes.map((n) => ({ id: n.id, needs: n.prereqs ?? [] })));
  if (!Array.isArray(graph.spine) || graph.spine.some((id) => !ids.has(id))) throw new Error("spine references unknown node");
  if (!Array.isArray(graph.themes) || !graph.themes.length) throw new Error("need >= 1 theme");
  for (const tid of graph.themes) {
    const t = themes[tid];
    if (!t) throw new Error(`missing theme "${tid}"`);
    if (!t.label || !t.subject || !t.bossHook || !t.visual?.accent || !t.visual?.actorIcon)
      throw new Error(`theme "${tid}" missing label/subject/bossHook/visual`);
    // Vocab keys an archetype hard-requires (others have in-component fallbacks).
    for (const key of manifests[shape].requiredThemeVocab ?? []) {
      if (!t.vocab?.[key]) throw new Error(`theme "${tid}" needs vocab.${key}`);
    }
    for (const n of graph.nodes) validateThemeEntry(shape, t.nodes?.[n.id], n.level);
  }
  // Every node's level must satisfy the archetype's own validate() (run out-of-process).
  // Batched into one subprocess for the whole graph after the cheap structural checks pass.
  await validateLevelsForShape(root, shape, graph.nodes.map((n) => ({ label: `node ${n.id}`, level: n.level })));
}

// Each archetype emits a FIXED set of play-state signals, declared in its manifest
// (`failureModes`). Rather than trust the model to author correct tags, the server
// attaches these canonical failure modes deterministically — so authored topics get a
// working self-heal loop for free.
export function attachFailureModes(shape, graph, manifests) {
  const specs = manifests?.[shape]?.failureModes;
  if (!specs || !specs.length) return;
  const primaryGap = (specs.find((s) => s.primary) ?? specs[0]).gap;
  const sidequest = graph.nodes.find((n) => n.type === "sidequest");
  if (sidequest) {
    sidequest.clearsGap = primaryGap;
    if (!sidequest.remediates) {
      const lvl = graph.nodes.find((n) => n.type === "level" && (n.prereqs || []).length > 0);
      if (lvl) sidequest.remediates = lvl.id;
    }
  }
  const primaryRemediation = sidequest ? `sidequest:${sidequest.id}` : `generate:${slug(primaryGap)}-drill`;
  for (const n of graph.nodes) {
    if (n.type === "sidequest") continue;
    if ((n.prereqs || []).length === 0) continue; // the intro/root level stays gentle
    n.failureModes = specs.map((s) => ({
      signal: { tag: s.tag, minCount: s.minCount },
      gap: s.gap,
      remediation: s.primary ? primaryRemediation : s.remediation,
    }));
  }
}

export function normalizeTopic(concept, parsed) {
  const shape = parsed.shape;
  const graph = parsed.graph ?? {};
  const themes = parsed.themes ?? {};
  graph.shape = shape;
  if (!Array.isArray(graph.themes) || !graph.themes.length) graph.themes = Object.keys(themes);
  for (const n of graph.nodes ?? []) n.shape = shape;
  return { shape, graph, themes, label: parsed.label || `🎓 ${titleCase(concept)}` };
}
