import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import * as fs from "node:fs";
import * as path from "node:path";

// `process` and the node:* built-ins are typed with no @types/node dependency: `process` via
// this local ambient const, node:fs/node:path via ambient module shims in node-shims.d.ts.
declare const process: { env: Record<string, string | undefined> };

// ── cq:archetype-guard ──────────────────────────────────────────────────────────────────
// Turns the cryptic "Failed to resolve import './Component'" Vite stack — thrown whenever an
// archetype is scaffolded contract-first (engine + module + manifest) and its render layer
// (Component.tsx + scene.ts) isn't written yet — into ONE clear message naming the incomplete
// directory and the missing file. The registry already fault-isolates these at runtime (the
// dev app still boots and just skips the unfinished shape), so this only WARNS in dev; it
// hard-FAILS `vite build`, so a half-authored archetype can't reach production or slip past CI.

const ARCHETYPES_DIR = "src/archetypes";
const RESOLVE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".css", ".json", "/index.ts", "/index.tsx"];
const IMPORT_RE = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

interface Incomplete {
  file: string; // repo-relative path of the file with the dangling import
  missing: string[]; // the relative specifiers that don't resolve to a real file
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolvesFrom(fromDir: string, spec: string): boolean {
  const base = path.resolve(fromDir, spec);
  return RESOLVE_EXTS.some((ext) => isFile(base + ext));
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every archetype dir that HAS a module.ts (so the registry loads it) but imports a relative
 *  file that doesn't exist — anywhere in the dir's own .ts/.tsx tree (catches module→Component
 *  AND Component→scene). */
function scanArchetypes(root: string): Incomplete[] {
  const archetypesRoot = path.resolve(root, ARCHETYPES_DIR);
  let dirs: import("node:fs").Dirent[];
  try {
    dirs = fs.readdirSync(archetypesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Incomplete[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(archetypesRoot, d.name);
    if (!isFile(path.join(dir, "module.ts"))) continue; // only module.ts triggers registration
    for (const file of tsFiles(dir)) {
      const src = fs.readFileSync(file, "utf8");
      const specs = new Set<string>();
      for (const m of src.matchAll(IMPORT_RE)) specs.add(m[1]);
      const missing = [...specs].filter((s) => !resolvesFrom(path.dirname(file), s));
      if (missing.length) out.push({ file: path.relative(root, file), missing });
    }
  }
  return out;
}

function archetypeReport(incompletes: Incomplete[]): string {
  const lines = incompletes.map(
    (i) => `  • ${i.file} imports ${i.missing.map((s) => `"${s}"`).join(", ")} — file(s) not found`,
  );
  return [
    "Incomplete archetype(s): a directory has module.ts but imports files that don't exist.",
    "The registry skips these at runtime (the dev app still boots), but they must be finished",
    "or removed before a production build:",
    "",
    ...lines,
    "",
    'Finish the render layer (Component.tsx + scene.ts) — see CLAUDE.md ▸ "Recipe: add an',
    'archetype" — or delete the directory.',
  ].join("\n");
}

function archetypeGuard(): Plugin {
  let root = ".";
  let command: "build" | "serve" = "serve";
  return {
    name: "cq:archetype-guard",
    configResolved(cfg) {
      root = cfg.root;
      command = cfg.command;
    },
    buildStart() {
      const incompletes = scanArchetypes(root);
      if (!incompletes.length) return;
      const msg = archetypeReport(incompletes);
      // Production build / CI: fail hard. Dev: loud warning, but let the fault-isolated app run.
      if (command === "build") this.error(msg);
      else this.warn(`\n${msg}\n`);
    },
  };
}
// ────────────────────────────────────────────────────────────────────────────────────────

// The authoring server picks its port dynamically. `npm run dev:all` starts both together and
// sets CQ_SERVER_PORT so this proxy targets the right one; a standalone `npm run dev` falls
// back to 8787 (the port the server prefers). To point a standalone dev server at a non-default
// authoring port:  CQ_SERVER_PORT=<port> npm run dev
const authoringPort = process.env.CQ_SERVER_PORT || "8787";

export default defineConfig({
  plugins: [react(), archetypeGuard()],
  server: {
    // `node_modules` here is a SYMLINK to a sibling checkout (git worktrees share one
    // install), so its real path sits outside Vite's default fs allow-list and asset
    // files (e.g. @fontsource fonts) get rejected with "outside of Vite serving allow
    // list". Relax strict fs so the LOCAL dev server can serve them. Dev-only — this
    // has no effect on `vite build`.
    fs: { strict: false },
    // Proxy the play-time app's /api calls to the local authoring server.
    // Long timeouts: authoring a whole topic can take a couple of minutes.
    proxy: {
      "/api": {
        target: `http://localhost:${authoringPort}`,
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
      },
    },
  },
});
