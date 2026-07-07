// The authoring worker: turn a gap ticket into a real, schema-valid content node.
// Primary path: invoke the actual `claude` CLI headlessly. Safety net: a
// deterministic template author, so the loop ALWAYS closes with valid content
// even if the model is unavailable or returns something malformed.

import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { lintArchetypeFiles, buildProject, engineSelfTest } from "./archetypeGate.mjs";

const contentDir = (root, shape) => path.join(root, "public", "content", shape);
const archetypesDir = (root) => path.join(root, "src", "archetypes");

// Each archetype self-describes its authoring contract in an `archetype.manifest.json`
// beside its code. The server reads these instead of hard-coding the shape list, so
// adding an archetype (a new dir + manifest + reference content) extends authoring for
// free — no edits here. Shape -> manifest.
async function loadManifests(root) {
  const manifests = {};
  let entries = [];
  try {
    entries = await readdir(archetypesDir(root), { withFileTypes: true });
  } catch {
    return manifests;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const m = JSON.parse(await readFile(path.join(archetypesDir(root), e.name, "archetype.manifest.json"), "utf8"));
      if (m && m.shape) manifests[m.shape] = m;
    } catch {
      /* directory without a manifest — skip */
    }
  }
  return manifests;
}
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

function buildPrompt(ticket, refs, manifests) {
  const { graph, themes } = refs;
  const example =
    graph.nodes.find((n) => n.concept === ticket.gap) ||
    graph.nodes.find((n) => n.type === "sidequest") ||
    graph.nodes[0];
  const exampleThemes = {};
  for (const id of graph.themes) exampleThemes[id] = themes[id].nodes[example.id];

  return [
    `You are authoring ONE new remediation "sidequest" node for a browser learning game.`,
    `Archetype (shape): "${graph.shape}". The player interacts on a 2D stage to solve it; wrong approaches visibly fail and emit gap signals.`,
    `A learner has a GAP on the concept: "${ticket.gap}". Author a focused, slightly-easier drill that reinforces exactly that concept.`,
    ``,
    `Return ONLY a JSON object (no prose, no markdown) of exactly this shape:`,
    `{ "node": { "level": <same shape as the EXAMPLE level below> },`,
    `  "themes": { ${graph.themes.map((id) => `"${id}": <a theme entry like the EXAMPLE theme entries>`).join(", ")} } }`,
    ``,
    `Rules:`,
    `- node.level MUST be structurally valid for shape "${graph.shape}" and SOLVABLE.`,
    `- Every theme entry needs: title, hook, winText, and failText (keys matching the failure tags shown in the examples).`,
    `- ${manifests?.[graph.shape]?.drillLevelFormat ?? `node.level must match the "${graph.shape}" archetype's level format (mirror the EXAMPLE below).`}`,
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
  if (shape === "character-descent") {
    if (!level || typeof level.startDepth !== "number") throw new Error("level.startDepth must be a number");
    const V = ["stop", "descend", "descendSame"];
    const pre = Array.isArray(level.preplaced) ? level.preplaced : [];
    const pal = Array.isArray(level.palette) ? level.palette : [];
    for (const b of [...pre, ...pal]) if (!V.includes(b)) throw new Error(`invalid block "${b}"`);
    const all = new Set([...pre, ...pal]);
    if (!all.has("stop") || !all.has("descend")) throw new Error("not solvable: needs stop + descend obtainable");
  } else if (shape === "binary-search") {
    const vals = level && level.values;
    if (!Array.isArray(vals) || vals.length < 2 || !vals.every((n) => typeof n === "number"))
      throw new Error("level.values must be an array of >= 2 numbers");
    for (let i = 1; i < vals.length; i += 1)
      if (vals[i] <= vals[i - 1]) throw new Error("level.values must be strictly ascending");
    if (typeof level.targetIndex !== "number" || level.targetIndex < 0 || level.targetIndex >= vals.length)
      throw new Error("level.targetIndex out of range");
  } else {
    // A registered archetype without a builtin structural guard here (e.g. a Stage-2
    // generated shape). Correctness is enforced by the archetype's own module.validate()
    // and its engine self-test; the server only insists the level is present.
    if (!level || typeof level !== "object") throw new Error(`shape "${shape}": level must be an object`);
  }
}

function validateThemeEntry(shape, e, _level) {
  if (!e || typeof e.title !== "string" || typeof e.hook !== "string" || typeof e.winText !== "string") {
    throw new Error("theme entry needs title, hook, winText");
  }
  // The builtin archetypes theme purely through the node's title/hook/winText/failText
  // plus the theme-level vocab/visual — there is no per-node `extra` payload to validate.
  // An archetype that needs `extra` validates it in its own module.validate() boundary.
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
  const manifests = await loadManifests(root);
  if (process.env.CQ_NO_CLAUDE !== "1") {
    try {
      onLog?.(`▸ Asking Claude Code to author a "${ticket.gap}" drill for the ${refs.graph.shape} archetype…`);
      const raw = await runClaudeStream(buildPrompt(ticket, refs, manifests), { onLog, onText }, 120000);
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

async function loadExample(root, shape, manifests) {
  const domain = manifests?.[shape]?.exampleDomain ?? shape;
  const dir = contentDir(root, domain);
  const graph = JSON.parse(await readFile(path.join(dir, "graph.json"), "utf8"));
  const theme = JSON.parse(await readFile(path.join(dir, "themes", `${graph.themes[0]}.json`), "utf8"));
  return { shape, blurb: manifests?.[shape]?.blurb ?? shape, graph, theme };
}

function buildTopicPrompt(concept, examples, manifests, lastErr) {
  const fix = lastErr
    ? `\nPREVIOUS ATTEMPT FAILED VALIDATION: ${lastErr}\nFix exactly that and return corrected JSON.\n`
    : "";
  const shapes = Object.keys(manifests);
  const options = shapes.map((s) => `- "${s}": ${manifests[s].classify}`);
  const formats = shapes.flatMap((s) => [
    ``,
    `If you choose "${s}": ${manifests[s].levelFormat} COPY THIS WORKING EXAMPLE's structure:`,
    JSON.stringify(examples[s].graph),
    JSON.stringify(examples[s].theme),
  ]);
  return [
    `Author a COMPLETE, concise playable learning game for the concept: "${concept}".`,
    `Every archetype renders on a 2D stage where a character acts out the idea. Pick the SHAPE that fits best:`,
    ...options,
    ``,
    `Make a SMALL curriculum: 4-5 nodes — one intro level (prereqs []), 1-2 middle levels, ONE boss (highest tier),`,
    `and ONE sidequest (type "sidequest", prereqs []) that reinforces the main idea — each teaching ONE idea, with`,
    `TRUE prerequisites (later depends on earlier). ONE theme naming everything for this concept. Keep all text short.`,
    ``,
    `Return ONLY JSON, no markdown, no prose:`,
    `{"shape":"<shape>","label":"<emoji + short title>","graph":{"shape":"<shape>","themes":["<themeId>"],"spine":[<level ids>],"nodes":[<node>...]},"themes":{"<themeId>":{"id":"<themeId>","label":"...","subject":"...","bossHook":"...","vocab":{...},"visual":{...},"nodes":{"<nodeId>":{...}}}}}`,
    `Node = {id,type:("level"|"boss"|"sidequest"),concept,tier:int,prereqs:[ids],shape,level,failureModes:[]}. Leave failureModes [] (added automatically). Prereqs acyclic; theme covers EVERY node id.`,
    ...formats,
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

function validateGraph(shape, graph, themes, manifests) {
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
    // Vocab keys an archetype hard-requires (others have in-component fallbacks).
    for (const key of manifests[shape].requiredThemeVocab ?? []) {
      if (!t.vocab?.[key]) throw new Error(`theme "${tid}" needs vocab.${key}`);
    }
    for (const n of graph.nodes) validateThemeEntry(shape, t.nodes?.[n.id], n.level);
  }
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
      validateGraph(topic.shape, topic.graph, topic.themes, manifests);
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

// Deterministic content-domain slug for a concept (dedup against existing domains).
// Shared by applyTopic and the archetype generator so a generated manifest's
// exampleDomain matches where the content actually lands.
async function nextDomainSlug(root, concept) {
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
  return s;
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

const EXAMPLE_ARCHETYPE_DIR = "batchPacking";

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

// Read every file of the worked-example archetype, relabelled to the fixed generated
// filenames (Component.tsx / styles.css) so the model copies a consistent structure.
async function loadArchetypeSource(root) {
  const base = path.join(root, "src", "archetypes", EXAMPLE_ARCHETYPE_DIR);
  const rd = (rel) => readFile(path.join(base, rel), "utf8");
  const types = await readFile(path.join(root, "src", "types.ts"), "utf8");
  const engine = await rd("engine.ts");
  const scene = await rd("scene.ts");
  const component = (await rd("BatchPacking.tsx")).replace(/(["'])\.\/batchPacking\.css\1/g, '"./styles.css"');
  const moduleTs = (await rd("module.ts")).replace(/(["'])\.\/BatchPacking\1/g, '"./Component"');
  const css = await rd("batchPacking.css");
  const manifest = await rd("archetype.manifest.json");
  const graph = await readFile(path.join(root, "public", "content", "batch-packing", "graph.json"), "utf8");
  const theme = await readFile(path.join(root, "public", "content", "batch-packing", "themes", "gpu-vllm.json"), "utf8");
  return { types, engine, scene, component, moduleTs, css, manifest, graph, theme };
}

// The wiring file is TEMPLATED (not generated): the registry glob discovers this
// GameModule. The generated engine exports `validate`; Component is its default export.
function moduleTemplate(shape, label) {
  return [
    `import Component from "./Component";`,
    `import { validate } from "./engine";`,
    ``,
    `// Wiring file (templated by the archetype generator). The registry auto-discovers`,
    `// this GameModule via glob; it meets the shell only at the GameModule contract.`,
    `export const archetypeModule = {`,
    `  shape: ${JSON.stringify(shape)},`,
    `  label: ${JSON.stringify(label)},`,
    `  component: Component,`,
    `  validate,`,
    `};`,
    "",
  ].join("\n");
}

// Generation is decomposed into ONE small model call per file (each a single artifact,
// which the local CLI produces fast and reliably — a whole-archetype request in one call
// times out). Each call outputs RAW file text (no JSON-escaping); helpers strip fences.
const camel = (kebab) => String(kebab).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
function stripFences(s) {
  const t = String(s ?? "").trim();
  const m = t.match(/^```[a-zA-Z0-9]*\s*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}
const fixNote = (e) => (e ? `\nThe previous attempt failed with: "${e}". Avoid that.` : "");

// --- one focused prompt per file (raw output; prior artifacts threaded in for coherence) ---
function pEngine(concept, ex, shape, hint, lastErr) {
  return [
    `Write ONLY the raw TypeScript for engine.ts of a NEW 2D learning-game archetype (shape id "${shape}") for the concept: "${concept}".`,
    hint?.idea ? `Intended mechanic: ${hint.idea}` : ``,
    `Make it structurally ANALOGOUS to this example engine, but a genuinely DIFFERENT mechanic (do NOT copy the subject):`,
    `=== EXAMPLE engine.ts (batch-packing) ===`,
    ex.engine,
    `RULES: PURE & deterministic. Import ONLY from "../../types" or nothing; NO React/Pixi/DOM/I-O/fetch/process/eval/Function/Math.random/Date. Export a Level type, a Play type, "export function evaluate(level, play): { outcome: string; signals: string[] }" (outcome "success" = a win; signals = gap tags a wrong play emits), and "export function validate(level): Level" (guard authored data; throw on malformed). ~80-140 lines.`,
    `Output ONLY the raw engine.ts code — no prose, no JSON, no markdown fences.`,
    fixNote(lastErr),
  ].filter(Boolean).join("\n");
}

function pManifest(concept, ex, shape, engineTs, lastErr) {
  return [
    `Write ONLY the raw JSON for archetype.manifest.json of the archetype "${shape}" (concept "${concept}"). Its engine.ts is:`,
    `=== engine.ts ===`,
    engineTs,
    `=== EXAMPLE manifest (batch-packing) ===`,
    ex.manifest,
    `RULES: JSON object with fields label, exampleDomain, blurb, classify, levelFormat, drillLevelFormat, requiredThemeVocab (array), failureModes (1-2 of {tag,minCount,gap, and primary:true OR remediation:"generate:<slug>-drill"}), and "selfTest": {"level": <a valid Level for THIS engine>, "cases": [{"play": <a Play>, "expect": "success"}, {"play": <a Play>, "expect": "signal:<tag>"}, ...]}. Include ≥1 success case and one case per failureMode tag; the level MUST be solvable and each tag reachable. The failureMode tags MUST be exactly the signal strings THIS engine emits.`,
    `Output ONLY the raw manifest JSON — no prose, no fences.`,
    fixNote(lastErr),
  ].join("\n");
}

function pGraph(concept, ex, shape, engineTs, manifest, lastErr) {
  const tags = (manifest.failureModes || []).map((f) => f.tag).join(", ");
  return [
    `Write ONLY the raw JSON for graph.json of the archetype "${shape}" (concept "${concept}"). Its engine.ts is:`,
    `=== engine.ts ===`,
    engineTs,
    `=== EXAMPLE graph.json (batch-packing) ===`,
    ex.graph,
    `RULES: {"shape":"${shape}","themes":["<themeId>"],"spine":[<level ids>],"nodes":[...]}. 4-5 nodes: one intro level (prereqs []), 1-2 middle levels, ONE boss (type "boss", highest tier), ONE sidequest (type "sidequest", prereqs []). node = {id,type,concept,tier,prereqs,shape:"${shape}",level,failureModes:[]} (leave failureModes []). EVERY node.level MUST satisfy the engine's validate() AND be solvable. (Signal tags are: ${tags}.)`,
    `Output ONLY the raw graph JSON — no prose, no fences.`,
    fixNote(lastErr),
  ].join("\n");
}

function pTheme(concept, ex, shape, graph, manifest, lastErr) {
  const ids = (graph.nodes || []).map((n) => n.id).join(", ");
  const tags = (manifest.failureModes || []).map((f) => f.tag).join(", ");
  return [
    `Write ONLY the raw JSON for ONE theme.json of the archetype "${shape}". The SUBJECT is the concept itself: "${concept}".`,
    `=== EXAMPLE theme.json (batch-packing) ===`,
    ex.theme,
    `RULES: {"id":"<themeId>","label":"<short>","subject":"<subject>","bossHook":"<one line>","vocab":{...archetype vocab...},"visual":{"accent":"#RRGGBB","actorIcon":"<emoji>"},"nodes":{...}}. "nodes" MUST include an entry for EVERY node id: ${ids}. Each entry = {title, hook, winText, failText?} where failText keys are the signal tags: ${tags}. Keep text short.`,
    `Output ONLY the raw theme JSON — no prose, no fences.`,
    fixNote(lastErr),
  ].join("\n");
}

function pScene(concept, ex, engineTs, lastErr) {
  return [
    `Write ONLY the raw TypeScript for scene.ts — a PixiJS RENDERER for this archetype's engine (concept "${concept}"). The engine is:`,
    `=== engine.ts ===`,
    engineTs,
    `=== EXAMPLE scene.ts (batch-packing) ===`,
    ex.scene,
    `RULES: RENDERER only — it DRAWS, never grades. Import from "pixi.js" and TYPES from "./engine" only. Export a class with "async init(container: HTMLElement)", a method to (re)draw the current level + play state, and "destroy()"; mirror the example's Application.init / canvas mount / ticker / destroy lifecycle.`,
    `Output ONLY the raw scene.ts code — no prose, no fences.`,
    fixNote(lastErr),
  ].join("\n");
}

function pComponent(concept, ex, engineTs, sceneTs, lastErr) {
  return [
    `Write ONLY the raw TSX for Component.tsx — the React component for this archetype (concept "${concept}").`,
    `=== CONTRACT (GameProps / Theme / ThemeNode) ===`,
    ex.types,
    `=== engine.ts ===`,
    engineTs,
    `=== scene.ts ===`,
    sceneTs,
    `=== EXAMPLE Component.tsx (batch-packing) ===`,
    ex.component,
    `RULES: "export default function" behind GameProps<Level> (import the Level type from "./engine"). Mount the scene ONCE via useEffect (async init guarded by an "alive" flag; destroy on cleanup — see example). Build the player's Play from UI interaction; call evaluate() from "./engine" ONLY to grade on a run; on a loss call onSignal(tag) for EACH returned signal (once); on a win call onComplete({ won: true }). Import "./scene", "./engine", "../../types", and "./styles.css". Read labels from theme.vocab with fallbacks; use themeNode.title/hook/winText/failText and the shared .rd-controls/.rd-run/.rd-outcome classes for run + outcome UI.`,
    `Output ONLY the raw Component.tsx code — no prose, no fences.`,
    fixNote(lastErr),
  ].join("\n");
}

function pStyles(concept, ex, componentTsx, lastErr) {
  return [
    `Write ONLY the raw CSS for styles.css of this archetype's Component (concept "${concept}"). The component is:`,
    `=== Component.tsx ===`,
    componentTsx,
    `=== EXAMPLE styles.css (batch-packing) ===`,
    ex.css,
    `RULES: style ONLY the island-local class names this component uses. Reuse shared tokens var(--accent)/var(--line)/var(--panel)/var(--muted); do NOT restyle the shared .rd-* classes. Concise.`,
    `Output ONLY the raw CSS — no prose, no fences.`,
    fixNote(lastErr),
  ].join("\n");
}

async function writeArchetypeFiles(archDir, files) {
  await mkdir(archDir, { recursive: true });
  for (const [name, src] of Object.entries(files)) {
    await writeFile(path.join(archDir, name), src.endsWith("\n") ? src : src + "\n");
  }
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
      validateGraph(shape, graph, themes, withNew);
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
