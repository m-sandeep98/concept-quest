// One-command dev launcher: start the authoring server and the Vite app together, each on a
// free port, with the proxy auto-wired. Picks a free port for the server, passes it as PORT
// (server) and CQ_SERVER_PORT (Vite proxy target); Vite self-selects its own free port.
// Ctrl-C (or either child exiting) tears both down.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Ask the OS for an unused port (bind :0, read it back, release it).
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const serverPort = Number(process.env.PORT) || (await freePort());
const env = { ...process.env, PORT: String(serverPort), CQ_SERVER_PORT: String(serverPort) };
const viteBin = path.join(root, "node_modules", ".bin", "vite");

console.log(`▸ authoring server → :${serverPort}  ·  Vite app → free port (see its printed URL)\n`);

const server = spawn(process.execPath, [path.join(root, "server", "server.mjs")], { cwd: root, env, stdio: "inherit" });
// `--config vite.config.ts` forces the TS source (the compiled vite.config.js is a symlink
// into the base checkout, which git worktrees share).
const vite = spawn(viteBin, ["--config", "vite.config.ts"], { cwd: root, env, stdio: "inherit" });

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [server, vite]) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  process.exit(code ?? 0);
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => shutdown(0));
server.on("exit", (code) => shutdown(code ?? 0));
vite.on("exit", (code) => shutdown(code ?? 0));
