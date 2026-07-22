// Content IO for the authoring pipeline: reading archetype manifests, reference graphs/themes,
// and the worked-example archetype source; picking reference nodes; writing generated files,
// domain slugs, and the domains index. Pure filesystem + selection — no claude, no validation.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { slug } from "./util.mjs";

export const contentDir = (root, shape) => path.join(root, "public", "content", shape);
export const archetypesDir = (root) => path.join(root, "src", "archetypes");
export const DOMAINS_FILE = (root) => path.join(root, "public", "content", "domains.json");

// Each archetype self-describes its authoring contract in an `archetype.manifest.json`
// beside its code. The server reads these instead of hard-coding the shape list, so
// adding an archetype (a new dir + manifest + reference content) extends authoring for
// free — no edits here. Shape -> manifest.
export async function loadManifests(root) {
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

export async function loadRefs(root, shape) {
  const dir = contentDir(root, shape);
  const graph = JSON.parse(await readFile(path.join(dir, "graph.json"), "utf8"));
  const themes = {};
  for (const id of graph.themes) {
    themes[id] = JSON.parse(await readFile(path.join(dir, "themes", `${id}.json`), "utf8"));
  }
  return { graph, themes };
}

export function uniqueId(base, graph) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

// The reference node a drill mirrors: the exact-concept node if present, else any
// sidequest, else the first node. Shared by the prompt builder, finalizer, and template.
export function pickExampleNode(graph, gap) {
  return (
    graph.nodes.find((n) => n.concept === gap) ||
    graph.nodes.find((n) => n.type === "sidequest") ||
    graph.nodes[0]
  );
}

export async function loadExample(root, shape, manifests) {
  const domain = manifests?.[shape]?.exampleDomain ?? shape;
  const dir = contentDir(root, domain);
  const graph = JSON.parse(await readFile(path.join(dir, "graph.json"), "utf8"));
  const theme = JSON.parse(await readFile(path.join(dir, "themes", `${graph.themes[0]}.json`), "utf8"));
  return { shape, blurb: manifests?.[shape]?.blurb ?? shape, graph, theme };
}

export const EXAMPLE_ARCHETYPE_DIR = "batchPacking";

// Read every file of the worked-example archetype, relabelled to the fixed generated
// filenames (Component.tsx / styles.css) so the model copies a consistent structure.
export async function loadArchetypeSource(root) {
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

export async function writeArchetypeFiles(archDir, files) {
  await mkdir(archDir, { recursive: true });
  for (const [name, src] of Object.entries(files)) {
    await writeFile(path.join(archDir, name), src.endsWith("\n") ? src : src + "\n");
  }
}

export async function updateDomains(root, entry) {
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
export async function nextDomainSlug(root, concept) {
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
