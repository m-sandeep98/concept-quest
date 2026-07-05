// The authoring worker: turn a gap ticket into a real, schema-valid content node.
// Primary path: invoke the actual `claude` CLI headlessly. Safety net: a
// deterministic template author, so the loop ALWAYS closes with valid content
// even if the model is unavailable or returns something malformed.

import { readFile, writeFile, mkdir } from "node:fs/promises";
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

// Streaming variant of runClaude: emits token deltas + lifecycle logs while
// Claude generates, and resolves with the final result text. Drives the live
// "Claude terminal". Uses --output-format stream-json (newline-delimited JSON).
export function runClaudeStream(prompt, { onText, onLog } = {}, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    let buf = "";
    let finalText = "";
    let err = "";
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill("SIGKILL");
        reject(new Error("claude timed out"));
      }
    }, timeoutMs);

    function handle(ev) {
      if (ev.type === "system" && ev.subtype === "init") onLog?.("● Claude Code session started");
      else if (
        ev.type === "stream_event" &&
        ev.event?.type === "content_block_delta" &&
        ev.event.delta?.type === "text_delta"
      )
        onText?.(ev.event.delta.text);
      else if (ev.type === "system" && ev.subtype === "api_retry") onLog?.("… rate-limited, retrying");
      else if (ev.type === "result" && ev.subtype === "success" && typeof ev.result === "string") {
        finalText = ev.result;
        const cost = ev.total_cost_usd != null ? ` · $${Number(ev.total_cost_usd).toFixed(4)}` : "";
        onLog?.(`● generation complete${cost}`);
      }
    }

    // Buffer bytes and split on newlines so events never straddle chunk boundaries.
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          handle(JSON.parse(line));
        } catch {
          /* skip non-JSON / partial */
        }
      }
    });
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
      if (buf.trim()) {
        try {
          handle(JSON.parse(buf));
        } catch {
          /* ignore */
        }
      }
      if (code !== 0) reject(new Error(`claude exited ${code}: ${err.slice(0, 200)}`));
      else if (!finalText) reject(new Error("claude produced no result"));
      else resolve(finalText);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
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

export async function authorNode(ticket, root, { onLog, onText } = {}) {
  const refs = await loadRefs(root, ticket.domain || ticket.shape);
  if (process.env.CQ_NO_CLAUDE !== "1") {
    try {
      onLog?.(`▸ Asking Claude Code to author a "${ticket.gap}" drill for the ${refs.graph.shape} archetype…`);
      const raw = await runClaudeStream(buildPrompt(ticket, refs), { onLog, onText }, 120000);
      const authored = finalize(ticket, normalizeParsed(parseJson(raw)), refs);
      onLog?.("✓ Drill validated.");
      return { authored, authoredBy: "claude" };
    } catch (e) {
      onLog?.(`✗ Claude path failed (${String(e && e.message ? e.message : e).slice(0, 120)}) — using deterministic template`);
      console.error("[author] claude path failed, falling back to template:", String(e).slice(0, 300));
    }
  }
  onLog?.("▸ Authoring from the deterministic template…");
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

// ============================================================================
// Whole-topic authoring: a bare concept -> a complete, validated, playable game.
// Same claude -> validate -> write pipeline, scaled from one node to a full graph.
// No silent fallback here: if it can't produce a VALID game, it fails loudly.
// ============================================================================

const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

const ARCHETYPE_BLURB = {
  sequence:
    "ordering / process / dependencies — steps that must happen in a valid order (recipes, pipelines, procedures, histories, life cycles, algorithms).",
  "recursive-descent":
    "self-similar nesting — a thing that contains a smaller copy of itself until a base case (recursion, fractals, nested structures, Russian dolls).",
};

async function loadExample(root, shape) {
  const dir = contentDir(root, shape);
  const graph = JSON.parse(await readFile(path.join(dir, "graph.json"), "utf8"));
  const theme = JSON.parse(await readFile(path.join(dir, "themes", `${graph.themes[0]}.json`), "utf8"));
  return { shape, blurb: ARCHETYPE_BLURB[shape] ?? shape, graph, theme };
}

function buildTopicPrompt(concept, seq, lastErr) {
  const fix = lastErr
    ? `\nPREVIOUS ATTEMPT FAILED VALIDATION: ${lastErr}\nFix exactly that and return corrected JSON.\n`
    : "";
  return [
    `Author a COMPLETE, concise playable learning game for the concept: "${concept}".`,
    `Pick the archetype whose SHAPE fits best:`,
    `- "sequence": ordering / process / dependencies (procedures, recipes, pipelines, histories, life cycles). PREFER THIS for most concepts.`,
    `- "recursive-descent": self-similar nesting (recursion, fractals, nested structures). Only if the concept literally nests inside itself.`,
    ``,
    `Make a SMALL curriculum: 4-5 nodes — one intro level (prereqs []), 1-2 middle levels, ONE boss (highest tier),`,
    `and ONE sidequest (type "sidequest", prereqs []) that reinforces the main idea — each teaching ONE idea, with`,
    `TRUE prerequisites (later depends on earlier). ONE theme naming everything for this concept. Keep all text short.`,
    ``,
    `Return ONLY JSON, no markdown, no prose:`,
    `{"shape":"<shape>","label":"<emoji + short title>","graph":{"shape":"<shape>","themes":["<themeId>"],"spine":[<level ids>],"nodes":[<node>...]},"themes":{"<themeId>":{"id":"<themeId>","label":"...","subject":"...","bossHook":"...","vocab":{...},"visual":{...},"nodes":{"<nodeId>":{...}}}}}`,
    `Node = {id,type:("level"|"boss"|"sidequest"),concept,tier:int,prereqs:[ids],shape,level,failureModes:[]}. Leave failureModes [] (added automatically). Prereqs acyclic; theme covers EVERY node id.`,
    ``,
    `If you choose "sequence", copy THIS working example's structure EXACTLY — node.level = {steps:[{id,needs:[ids]}]};`,
    `each theme node entry has extra.steps {"<stepId>":{"label","icon"}} for EVERY step id; theme has vocab.run + visual{accent,actorIcon}:`,
    JSON.stringify(seq.graph),
    JSON.stringify(seq.theme),
    ``,
    `If you choose "recursive-descent": node.level = {startDepth:int,preplaced:[blocks],palette:[blocks],requiredBlocks:["stop","descend"]}`,
    `with blocks in "stop"|"descend"|"descendSame" (stop+descend obtainable). Theme has vocab{run,stop,descend,descendSame,unit,depthLabel}`,
    `+ visual{accent,actorIcon,containerShape,coreIcon}; each node entry {title,hook,winText,failText?}.`,
    fix,
  ].join("\n");
}

function normalizeTopic(concept, parsed) {
  const shape = parsed.shape;
  const graph = parsed.graph ?? {};
  const themes = parsed.themes ?? {};
  graph.shape = shape;
  if (!Array.isArray(graph.themes) || !graph.themes.length) graph.themes = Object.keys(themes);
  for (const n of graph.nodes ?? []) n.shape = shape;
  return { shape, graph, themes, label: parsed.label || `🎓 ${titleCase(concept)}` };
}

function validateGraph(shape, graph, themes) {
  if (shape !== "sequence" && shape !== "recursive-descent") throw new Error(`unknown shape "${shape}"`);
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
    validateLevel(shape, n.level);
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
    if (!t.vocab?.run) throw new Error(`theme "${tid}" needs vocab.run`);
    if (shape === "recursive-descent" && (!t.vocab.stop || !t.vocab.descend || !t.vocab.descendSame))
      throw new Error(`theme "${tid}" needs vocab.stop/descend/descendSame`);
    for (const n of graph.nodes) validateThemeEntry(shape, t.nodes?.[n.id], n.level);
  }
}

// Each archetype emits a FIXED set of play-state signals. Rather than trust the
// model to author correct tags, the server attaches the canonical failure modes
// deterministically — so authored topics get a working self-heal loop for free.
const FAILURE_MODES = {
  sequence: [
    { tag: "dependency-violation", minCount: 2, gap: "prerequisites", primary: true },
    { tag: "wrong-start", minCount: 2, gap: "the starting point", remediation: "generate:find-the-start-drill" },
  ],
  "recursive-descent": [
    { tag: "missing-base-case", minCount: 2, gap: "base case", primary: true },
    { tag: "no-progress", minCount: 2, gap: "recursive case", remediation: "generate:shrinking-drill" },
  ],
};

export function attachFailureModes(shape, graph) {
  const specs = FAILURE_MODES[shape];
  if (!specs) return;
  const primaryGap = specs.find((s) => s.primary).gap;
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

export async function authorTopic(concept, root, { attempts = 2, onLog, onText } = {}) {
  let seq;
  try {
    seq = await loadExample(root, "sequence");
  } catch {
    throw new Error("missing sequence reference content");
  }
  let lastErr = "";
  for (let i = 0; i < attempts; i += 1) {
    try {
      onLog?.(`▸ Asking Claude Code to classify "${concept}" and author a full game… (attempt ${i + 1})`);
      const text = await runClaudeStream(buildTopicPrompt(concept, seq, lastErr), { onLog, onText }, 300000);
      onLog?.("▸ Parsing and validating the authored graph…");
      const topic = normalizeTopic(concept, parseJson(text));
      attachFailureModes(topic.shape, topic.graph);
      validateGraph(topic.shape, topic.graph, topic.themes);
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

const DOMAINS_FILE = (root) => path.join(root, "public", "content", "domains.json");

async function updateDomains(root, entry) {
  const file = DOMAINS_FILE(root);
  let doc = { domains: [] };
  try {
    doc = JSON.parse(await readFile(file, "utf8"));
  } catch {
    /* create fresh */
  }
  if (!doc.domains.some((d) => d.slug === entry.slug)) doc.domains.push(entry);
  await writeFile(file, JSON.stringify(doc, null, 2) + "\n");
}

export async function applyTopic(concept, topic, root) {
  const base = slug(concept) || "topic";
  let existing = [];
  try {
    existing = JSON.parse(await readFile(DOMAINS_FILE(root), "utf8")).domains.map((d) => d.slug);
  } catch {
    /* none yet */
  }
  let s = base;
  let i = 2;
  while (existing.includes(s)) s = `${base}-${i++}`;

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
