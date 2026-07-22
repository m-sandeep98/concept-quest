// Prompt construction for every model call in the authoring pipeline: the self-heal drill
// prompt, the whole-topic prompt, the templated module wiring, and the seven per-file
// archetype-generation prompts. Pure string building — no I/O, no claude, no validation.

import { pickExampleNode } from "./content.mjs";

export function buildPrompt(ticket, refs, manifests) {
  const { graph, themes } = refs;
  const example = pickExampleNode(graph, ticket.gap);
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

export function buildTopicPrompt(concept, examples, manifests, lastErr) {
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

// The wiring file is TEMPLATED (not generated): the registry glob discovers this
// GameModule. The generated engine exports `validate`; Component is its default export.
export function moduleTemplate(shape, label) {
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

const fixNote = (e) => (e ? `\nThe previous attempt failed with: "${e}". Avoid that.` : "");

// --- one focused prompt per file (raw output; prior artifacts threaded in for coherence) ---
export function pEngine(concept, ex, shape, hint, lastErr) {
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

export function pManifest(concept, ex, shape, engineTs, lastErr) {
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

export function pGraph(concept, ex, shape, engineTs, manifest, lastErr) {
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

export function pTheme(concept, ex, shape, graph, manifest, lastErr) {
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

export function pScene(concept, ex, engineTs, lastErr) {
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

export function pComponent(concept, ex, engineTs, sceneTs, lastErr) {
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

export function pStyles(concept, ex, componentTsx, lastErr) {
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
