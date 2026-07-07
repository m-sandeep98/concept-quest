// Runs a (possibly generated) archetype engine's self-test in isolation, in its own
// process so a runaway generated engine can be time-boxed and killed by the caller.
// Args: <engineMjs> <selfTestJson>. Exit 0 = all cases matched; 1 = a mismatch/throw.
//
// The engine contract every generated archetype must satisfy:
//   export function evaluate(level, play): { outcome: string; signals: string[] }
// `outcome === "success"` is a win; `signals` are the gap tags a wrong play emits.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [engineMjs, selfTestJson] = process.argv.slice(2);

const mod = await import(pathToFileURL(engineMjs).href);
const evaluate = mod.evaluate;
if (typeof evaluate !== "function") {
  console.error("engine must export function evaluate(level, play)");
  process.exit(1);
}

const st = JSON.parse(readFileSync(selfTestJson, "utf8"));
if (!st || st.level == null || !Array.isArray(st.cases) || !st.cases.length) {
  console.error("selfTest: needs { level, cases: [...] }");
  process.exit(1);
}

let wins = 0;
for (const [i, c] of st.cases.entries()) {
  let r;
  try {
    r = evaluate(st.level, c.play);
  } catch (e) {
    console.error(`case ${i}: evaluate threw: ${e && e.message ? e.message : e}`);
    process.exit(1);
  }
  if (!r || typeof r.outcome !== "string" || !Array.isArray(r.signals)) {
    console.error(`case ${i}: evaluate must return { outcome: string, signals: string[] }`);
    process.exit(1);
  }
  if (c.expect === "success") {
    if (r.outcome !== "success") {
      console.error(`case ${i}: expected success, got "${r.outcome}"`);
      process.exit(1);
    }
    wins += 1;
  } else if (typeof c.expect === "string" && c.expect.startsWith("signal:")) {
    const tag = c.expect.slice("signal:".length);
    if (!r.signals.includes(tag)) {
      console.error(`case ${i}: expected signal "${tag}", got [${r.signals.join(", ")}]`);
      process.exit(1);
    }
  } else {
    console.error(`case ${i}: bad expect "${c.expect}" (use "success" or "signal:<tag>")`);
    process.exit(1);
  }
}

if (wins < 1) {
  console.error("selfTest: no winning case — the level may be unsolvable");
  process.exit(1);
}
console.log(`selfTest OK: ${st.cases.length} cases, ${wins} win(s)`);
process.exit(0);
