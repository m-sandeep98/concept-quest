// The authoring worker: turn a gap ticket into a real, schema-valid content node.
// Primary path: invoke the actual `claude` CLI headlessly. Safety net: a
// deterministic template author, so the loop ALWAYS closes with valid content
// even if the model is unavailable or returns something malformed.

import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const contentDir = (root, shape) => path.join(root, "public", "content", shape);
const clone = (o) => JSON.parse(JSON.stringify(o));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

async function loadRefs(root, shape) {
  const dir = contentDir(root, shape);
  const graph = JSON.parse(await readFile(path.join(dir, "graph.json"), "utf8"));
  const themes = {};
  for (const id of graph.themes) {
    themes[id] = JSON.parse(await readFile(path.join(dir, "themes", `${id}.json`), "utf8"));
  }
  return { graph, themes };
}

function uniqueId(base, graph) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

// ---------- the real Claude Code invocation ----------

function runClaude(prompt, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill("SIGKILL");
        reject(new Error("claude timed out"));
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`claude exited ${code}: ${err.slice(0, 200)}`));
      else resolve(out);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON object in claude output");
  return JSON.parse(body.slice(start, end + 1));
}

function buildPrompt(ticket, refs) {
  const { graph, themes } = refs;
  const example =
    graph.nodes.find((n) => n.concept === ticket.gap) ||
    graph.nodes.find((n) => n.type === "sidequest") ||
    graph.nodes[0];
  const exampleThemes = {};
  for (const id of graph.themes) exampleThemes[id] = themes[id].nodes[example.id];

  return [
    `You are authoring ONE new remediation "sidequest" node for a browser learning game.`,
    `Archetype (shape): "${graph.shape}". The player builds/arranges a rule and runs it; wrong builds visibly fail.`,
    `A learner has a GAP on the concept: "${ticket.gap}". Author a focused, slightly-easier drill that reinforces exactly that concept.`,
    ``,
    `Return ONLY a JSON object (no prose, no markdown) of exactly this shape:`,
    `{ "node": { "level": <same shape as the EXAMPLE level below> },`,
    `  "themes": { ${graph.themes.map((id) => `"${id}": <a theme entry like the EXAMPLE theme entries>`).join(", ")} } }`,
    ``,
    `Rules:`,
    `- node.level MUST be structurally valid for shape "${graph.shape}" and SOLVABLE.`,
    `- Every theme entry needs: title, hook, winText, and failText (keys matching the failure tags shown in the examples).`,
    graph.shape === "sequence"
      ? `- For sequence: node.level.steps is [{id, needs:[ids]}]; there must be at least one step with needs [] and no cycles. Each theme entry needs extra.steps with a {label, icon} for EVERY step id.`
      : `- For recursive-descent: node.level has {startDepth:int, preplaced:[blocks], palette:[blocks]} where blocks are "stop"|"descend"|"descendSame"; "stop" and "descend" must be obtainable (preplaced or palette).`,
    `- Anything referenced in themes (step ids / blocks) must exist in node.level.`,
    ``,
    `EXAMPLE node.level:`,
    JSON.stringify(example.level),
    `EXAMPLE theme entries:`,
    JSON.stringify(exampleThemes),
  ].join("\n");
}

// ---------- validation (guards ALL authored content, model or template) ----------

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

function validateLevel(shape, level) {
  if (shape === "recursive-descent") {
    if (!level || typeof level.startDepth !== "number") throw new Error("level.startDepth must be a number");
    const V = ["stop", "descend", "descendSame"];
    const pre = Array.isArray(level.preplaced) ? level.preplaced : [];
    const pal = Array.isArray(level.palette) ? level.palette : [];
    for (const b of [...pre, ...pal]) if (!V.includes(b)) throw new Error(`invalid block "${b}"`);
    const all = new Set([...pre, ...pal]);
    if (!all.has("stop") || !all.has("descend")) throw new Error("not solvable: needs stop + descend obtainable");
  } else if (shape === "sequence") {
    if (!level || !Array.isArray(level.steps) || level.steps.length < 2) throw new Error("level.steps must have >= 2 steps");
    const ids = new Set(level.steps.map((s) => s.id));
    if (ids.size !== level.steps.length) throw new Error("duplicate step ids");
    let hasRoot = false;
    for (const s of level.steps) {
      if (typeof s.id !== "string") throw new Error("step id must be a string");
      const needs = Array.isArray(s.needs) ? s.needs : [];
      if (needs.length === 0) hasRoot = true;
      for (const n of needs) if (!ids.has(n)) throw new Error(`step "${s.id}" needs missing id "${n}"`);
    }
    if (!hasRoot) throw new Error("no starting step (one with needs [])");
    topoOrThrow(level.steps.map((s) => ({ id: s.id, needs: s.needs || [] })));
  } else {
    throw new Error(`unknown shape "${shape}"`);
  }
}

function validateThemeEntry(shape, e, level) {
  if (!e || typeof e.title !== "string" || typeof e.hook !== "string" || typeof e.winText !== "string") {
    throw new Error("theme entry needs title, hook, winText");
  }
  if (shape === "sequence") {
    const steps = e.extra && e.extra.steps;
    if (!steps) throw new Error("sequence theme entry needs extra.steps");
    for (const s of level.steps) {
      if (!steps[s.id] || typeof steps[s.id].label !== "string") throw new Error(`missing step label for "${s.id}"`);
    }
  }
}

function finalize(ticket, partial, refs) {
  const { graph } = refs;
  const example =
    graph.nodes.find((n) => n.concept === ticket.gap) ||
    graph.nodes.find((n) => n.type === "sidequest") ||
    graph.nodes[0];
  const level = partial.node && partial.node.level;
  validateLevel(graph.shape, level);

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

function templateAuthor(ticket, refs) {
  const { graph, themes } = refs;
  const src =
    graph.nodes.find((n) => n.concept === ticket.gap) ||
    graph.nodes.find((n) => n.type === "sidequest") ||
    graph.nodes[0];
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
  return finalize(ticket, partial, refs);
}

export async function authorNode(ticket, root) {
  const refs = await loadRefs(root, ticket.shape);
  if (process.env.CQ_NO_CLAUDE !== "1") {
    try {
      const raw = await runClaude(buildPrompt(ticket, refs));
      const authored = finalize(ticket, normalizeParsed(parseJson(raw)), refs);
      return { authored, authoredBy: "claude" };
    } catch (e) {
      console.error("[author] claude path failed, falling back to template:", String(e).slice(0, 300));
    }
  }
  return { authored: templateAuthor(ticket, refs), authoredBy: "template" };
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
