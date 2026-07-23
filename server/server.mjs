// Local authoring server — the offline half of Concept Quest.
// The browser (play-time) never calls an LLM; it just talks to this. Three seams ride it:
// self-heal tickets, whole-topic authoring, and the learner's permanent doubt-chat session.
//
// This file is the composition root ONLY: CORS gate → route modules in order → 404. Adding a
// seam means adding a module to ROUTES, never editing the dispatch below.

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { send, originAllowed, listenOnFreePort } from "./http.mjs";
import { ensureQueue, queueDir } from "./tickets.mjs";
import { chatDir } from "./chat.mjs";
import { mkdir } from "node:fs/promises";
import ticketRoutes from "./routes/tickets.mjs";
import topicRoutes from "./routes/topics.mjs";
import chatRoutes from "./routes/chat.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// Ports are dynamic. Prefer $PORT (else 8787); if it's busy, scan upward for a free one so a
// second checkout or a stale server never blocks startup. `npm run dev:all` passes a free
// PORT and points the Vite proxy at it via CQ_SERVER_PORT.
const PREFERRED_PORT = Number(process.env.PORT) || 8787;

await ensureQueue(ROOT);
await mkdir(chatDir(ROOT), { recursive: true });

// Each route module returns true once it has handled the request. Order is irrelevant
// between modules (their path prefixes don't overlap); it matters only inside one.
const ROUTES = [ticketRoutes, topicRoutes, chatRoutes];

const INDEX = {
  service: "Concept Quest authoring server",
  note: "This is the API only — open the game at the Vite dev URL it prints (default http://localhost:5173).",
  endpoints: [
    "GET /api/health",
    "GET /api/tickets",
    "POST /api/tickets",
    "POST /api/tickets/:id/author",
    "DELETE /api/tickets/:id",
    "POST /api/topics",
    "GET /api/topics/stream?concept=…",
    "GET /api/chat/:thread",
    "GET /api/chat/:thread/stream?q=…",
    "DELETE /api/chat/:thread",
  ],
};

const server = http.createServer(async (req, res) => {
  res.reqOrigin = req.headers.origin;
  if (req.method === "OPTIONS") return send(res, 204, {});
  // A browser page from another origin cannot drive this local tool.
  if (!originAllowed(res.reqOrigin)) return send(res, 403, { error: "cross-origin request refused" });
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api")) return send(res, 200, INDEX);
    if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true });

    for (const route of ROUTES) {
      if (await route(req, res, url, { root: ROOT })) return;
    }

    send(res, 404, {
      error: "not found",
      hint: "This is the API server. Open the game at the Vite dev URL (default http://localhost:5173).",
    });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
});

const boundPort = await listenOnFreePort(server, PREFERRED_PORT);
console.log(`🎫 Concept Quest authoring server → http://localhost:${boundPort}`);
console.log(`   queue: ${queueDir(ROOT)}  ·  chat: ${chatDir(ROOT)}`);
if (boundPort !== PREFERRED_PORT) {
  console.log(`   (preferred port ${PREFERRED_PORT} was busy — using ${boundPort})`);
  console.log(`   point a standalone dev server here with:  CQ_SERVER_PORT=${boundPort} npm run dev`);
}
