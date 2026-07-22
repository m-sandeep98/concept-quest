// Validate authored levels through an archetype engine's exported validate(), in its own
// process so an untrusted (possibly generated) engine can be time-boxed and killed by the
// caller. Args: <engineMjs> <levelsJson>.
//   exit 0 — every level passed validate()
//   exit 1 — a level failed; stderr is "<index>\t<message>" (the caller maps index -> node)
//   exit 2 — the engine exposes no validate() to run (infrastructure problem)
//
// The engine contract: `export function validate(level): Level` — guards authored data and
// throws on malformed input. It is the SAME check the browser runs at the GameModule boundary.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [engineMjs, levelsJson] = process.argv.slice(2);

const mod = await import(pathToFileURL(engineMjs).href);
const validate = mod.validate;
if (typeof validate !== "function") {
  console.error("engine must export function validate(level)");
  process.exit(2);
}

const levels = JSON.parse(readFileSync(levelsJson, "utf8"));
for (const [i, level] of levels.entries()) {
  try {
    validate(level);
  } catch (e) {
    console.error(`${i}\t${e && e.message ? e.message : e}`);
    process.exit(1);
  }
}

process.exit(0);
