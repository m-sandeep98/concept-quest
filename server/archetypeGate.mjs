// The Stage-2 safety gate. A (possibly LLM-generated) archetype only becomes live code
// after passing three checks, cheapest first:
//   1. lint      — the files obey the island rules: engine imports ONLY ../../types, is
//                  pure/deterministic (no I/O, eval, randomness, clock, DOM), exports
//                  evaluate(); no file reaches into another archetype or the shell.
//   2. build     — the whole TS project still typechecks AND bundles with the new files
//                  in it (`npm run build` — the repo's own correctness check).
//   3. self-test — the pure engine is solvable and emits its declared gap signals, run
//                  headlessly in a time-boxed subprocess.
//
// The engine is the correctness-critical, executed surface; the scene/Component are only
// typechecked+bundled here (their runtime proof is playing them in the browser).

import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

function run(cmd, args, { cwd, timeoutMs = 240000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill("SIGKILL");
        resolve({ code: 124, out, err: err + "\n[timed out]" });
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ code: 1, out, err: String(e) });
      }
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, out, err });
    });
  });
}

// Module specifiers of real import/export statements only — line-anchored so the word
// "from" inside a string/template (e.g. an FSM engine describing `from "${t.from}"`) is
// never mistaken for an import.
function importsOf(src) {
  const out = [];
  for (const raw of String(src).split("\n")) {
    const s = raw.trim();
    const m =
      s.match(/^import\b.*\bfrom\s*["']([^"']+)["']/) ||
      // re-exports ONLY (export * / export { … } / export type { … } from) — never
      // `export function`/`const`/… whose body may contain a `from "…"` string.
      s.match(/^export\s+(?:\*|\{|type\s*\{)[^\n]*\bfrom\s*["']([^"']+)["']/) ||
      s.match(/^import\s+["']([^"']+)["']/);
    if (m) out.push(m[1]);
  }
  return out;
}

const BANNED_ENGINE = [
  [/\brequire\s*\(/, "require()"],
  [/\beval\s*\(/, "eval()"],
  [/\bnew\s+Function\b/, "new Function"],
  [/\bimport\s*\(/, "dynamic import()"],
  [/\bfetch\s*\(/, "fetch()"],
  [/\bprocess\s*\./, "process.*"],
  [/\bMath\s*\.\s*random/, "Math.random"],
  [/(\bDate\s*\.\s*now|new\s+Date\s*\()/, "Date/now"],
  [/\b(window|document|localStorage)\b/, "DOM/browser globals"],
];

// Renderer files (scene.ts / Component.tsx / module.ts) legitimately touch the DOM and
// Pixi, so the engine's purity bans don't apply — but generated code still must not open
// network connections or evaluate strings. (module.ts is templated by us; scanning it is
// harmless.) This closes the gap where only engine.ts was security-scanned.
const BANNED_RENDER = [
  [/\beval\s*\(/, "eval()"],
  [/\bnew\s+Function\b/, "new Function"],
  [/\brequire\s*\(/, "require()"],
  [/\bimport\s*\(/, "dynamic import()"],
  [/\bfetch\s*\(/, "fetch()"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bprocess\s*\./, "process.*"],
  [/\bsendBeacon\b/, "navigator.sendBeacon"],
];

// Pure, fast, no I/O. Throws on the first violation.
export function lintArchetypeFiles(files) {
  const engine = files["engine.ts"];
  if (typeof engine !== "string") throw new Error("lint: engine.ts is missing");

  for (const imp of importsOf(engine)) {
    if (imp !== "../../types") {
      throw new Error(`lint: engine.ts may import ONLY "../../types" (found "${imp}") — the engine is a pure island.`);
    }
  }
  for (const [re, label] of BANNED_ENGINE) {
    if (re.test(engine)) {
      throw new Error(`lint: engine.ts uses ${label} — engines must be pure & deterministic (HARD RULE #4).`);
    }
  }
  if (!/export\s+function\s+evaluate\s*\(/.test(engine)) {
    throw new Error("lint: engine.ts must export `function evaluate(level, play)` returning { outcome, signals }.");
  }

  // No archetype file may reach outside its own island, except to the shared contract.
  for (const [name, src] of Object.entries(files)) {
    if (!/\.(ts|tsx)$/.test(name)) continue;
    for (const imp of importsOf(src)) {
      if (imp.startsWith("..") && imp !== "../../types") {
        throw new Error(`lint: ${name} imports "${imp}" — archetypes are islands; only "../../types" is shared (HARD RULE #2).`);
      }
    }
    // engine.ts got the stricter purity scan above; scan the renderer files for the
    // network/eval subset they must also never use.
    if (name !== "engine.ts") {
      for (const [re, label] of BANNED_RENDER) {
        if (re.test(src)) {
          throw new Error(`lint: ${name} uses ${label} — generated archetype code may not make network or eval calls.`);
        }
      }
    }
  }
}

// Whole-project typecheck + bundle — the repo's own correctness check. Proves the new
// files compile AND that Vite can resolve/bundle the scene + Component (catches bad Pixi
// imports a bare tsc would miss).
export async function buildProject(root, { timeoutMs = 240000 } = {}) {
  const { code, out, err } = await run("npm", ["run", "build"], { cwd: root, timeoutMs });
  if (code !== 0) {
    const lines = `${out}\n${err}`.split("\n").filter((l) => /error|Error|TS\d+/.test(l)).slice(0, 25);
    throw new Error(`build failed:\n${(lines.length ? lines : `${err}`.split("\n").slice(-25)).join("\n")}`);
  }
}

// Transpile the engine (strip types) and run its self-test in a time-boxed subprocess.
export async function engineSelfTest(root, engineTsPath, selfTest, { timeoutMs = 30000 } = {}) {
  const tmpDir = path.join(root, "node_modules", ".cache", "cq-selftest");
  await mkdir(tmpDir, { recursive: true });
  const engineMjs = path.join(tmpDir, "engine.mjs");
  const stJson = path.join(tmpDir, "selftest.json");

  const trans = await run("npx", ["esbuild", engineTsPath, "--format=esm", "--platform=node", `--outfile=${engineMjs}`, "--log-level=error"], {
    cwd: root,
    timeoutMs,
  });
  if (trans.code !== 0) throw new Error(`self-test: engine failed to transpile:\n${trans.err}`);

  await writeFile(stJson, JSON.stringify(selfTest));
  const runner = path.join(root, "server", "_selfTestRunner.mjs");
  const res = await run("node", [runner, engineMjs, stJson], { cwd: root, timeoutMs });
  if (res.code !== 0) throw new Error(`self-test failed: ${(res.err || res.out).trim()}`);
}

// Orchestrate all three, cheapest first. `files` is the in-memory {name: source} map (for
// lint); `dir` is the archetype's directory name under src/archetypes (already written to
// disk for the build + self-test).
export async function validateArchetype(root, { dir, files, manifest }, { onLog } = {}) {
  onLog?.("▸ gate 1/3 — lint: island rules + pure engine…");
  lintArchetypeFiles(files);
  onLog?.("▸ gate 2/3 — build: whole project typechecks & bundles…");
  await buildProject(root);
  onLog?.("▸ gate 3/3 — self-test: engine solvable & emits its gap signals…");
  if (!manifest?.selfTest) throw new Error("manifest.selfTest is required to gate a generated engine");
  await engineSelfTest(root, path.join(root, "src", "archetypes", dir, "engine.ts"), manifest.selfTest);
  onLog?.("✓ archetype passed the gate (lint · build · self-test).");
}
