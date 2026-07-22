// Local authoring server — the offline half of the self-heal loop.
// The browser (play-time) never calls an LLM; it just POSTs tickets here.
// This server invokes Claude Code to author content into the graph on demand.

import http from "node:http";
import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authorNode, applyAuthored, authorTopic, applyTopic } from "./author.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const QUEUE = path.join(__dirname, "queue");
// Ports are dynamic. Prefer $PORT (else 8787); if it's busy, scan upward for a free one so a
// second checkout or a stale server never blocks startup. `npm run dev:all` passes a free
// PORT and points the Vite proxy at it via CQ_SERVER_PORT.
const PREFERRED_PORT = Number(process.env.PORT) || 8787;

await mkdir(QUEUE, { recursive: true });

// This server spawns `claude -p` (spends money) and writes files. It is local-only. Since
// both the dev app (Vite) and this server pick ports dynamically, we allow any localhost /
// 127.0.0.1 origin rather than a fixed port. Requests with NO Origin header (curl, or the
// app's own same-origin calls via the Vite proxy) are allowed; a genuinely cross-origin
// REMOTE page — whose Origin is its own domain, not localhost — is still refused, so a
// random page you happen to have open can't drive authoring or delete queue files.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const originAllowed = (origin) => !origin || LOCAL_ORIGIN.test(origin);

// Ticket ids and content domains become path segments (queue/<id>.json, content/<domain>/).
// Reject anything that could escape its directory (`..`, slashes, etc.).
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
function safeSegment(value, what) {
  const v = String(value ?? "");
  if (v === "." || v === ".." || !SAFE_SEGMENT.test(v)) throw new Error(`invalid ${what}`);
  return v;
}

async function listTickets() {
  const files = (await readdir(QUEUE)).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await readFile(path.join(QUEUE, f), "utf8")));
    } catch {
      /* skip corrupt */
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}
const save = (t) => writeFile(path.join(QUEUE, `${t.id}.json`), JSON.stringify(t, null, 2));
async function getTicket(id) {
  let safe;
  try {
    safe = safeSegment(id, "ticket id");
  } catch {
    return null; // malformed id -> treat as "no such ticket"
  }
  try {
    return JSON.parse(await readFile(path.join(QUEUE, `${safe}.json`), "utf8"));
  } catch {
    return null;
  }
}

function send(res, code, body) {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
  // Echo the origin back only when it's allow-listed (never a wildcard on a server
  // that can spend money / write files). `res.reqOrigin` is set per request below.
  if (res.reqOrigin && originAllowed(res.reqOrigin)) headers["access-control-allow-origin"] = res.reqOrigin;
  res.writeHead(code, headers);
  res.end(JSON.stringify(body));
}

// Server-Sent Events: stream authoring logs + Claude's live output to the browser.
function sseInit(res) {
  const headers = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    vary: "origin",
  };
  if (res.reqOrigin && originAllowed(res.reqOrigin)) headers["access-control-allow-origin"] = res.reqOrigin;
  res.writeHead(200, headers);
  res.write(": connected\n\n");
  return {
    send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    end: () => res.end(),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.reqOrigin = req.headers.origin;
  if (req.method === "OPTIONS") return send(res, 204, {});
  // A browser page from another origin cannot drive this local tool.
  if (!originAllowed(res.reqOrigin)) return send(res, 403, { error: "cross-origin request refused" });
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api")) {
      return send(res, 200, {
        service: "Concept Quest authoring server",
        note: "This is the API only — open the game at the Vite dev URL it prints (default http://localhost:5173).",
        endpoints: ["GET /api/health", "GET /api/tickets", "POST /api/tickets", "POST /api/tickets/:id/author", "DELETE /api/tickets/:id"],
      });
    }
    if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/api/tickets") return send(res, 200, await listTickets());

    if (req.method === "POST" && url.pathname === "/api/tickets") {
      const body = await readBody(req);
      if (!body.shape) return send(res, 400, { error: "shape required" });
      let domain;
      try {
        safeSegment(body.shape, "shape");
        domain = safeSegment(body.domain || body.shape, "domain");
      } catch (e) {
        return send(res, 400, { error: String(e.message) });
      }
      // dedupe: reuse an open ticket for the same gap in the same domain
      const open = (await listTickets()).find(
        (x) => x.domain === domain && x.gap === body.gap && x.spec === (body.spec || "") && x.status !== "done"
      );
      if (open) return send(res, 200, open);
      const t = {
        id: `t-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        domain,
        shape: body.shape,
        spec: body.spec || "",
        gap: body.gap || "",
        source: body.source || "",
        kind: body.kind || "generate",
        status: "todo",
        createdAt: Date.now(),
      };
      await save(t);
      return send(res, 201, t);
    }

    if (req.method === "POST" && url.pathname === "/api/topics") {
      const body = await readBody(req);
      const concept = String(body.concept || "").trim();
      if (!concept) return send(res, 400, { error: "concept required" });
      const lineage = { parent: body.parent || undefined, fromConcept: body.fromConcept || undefined };
      try {
        const topic = await authorTopic(concept, ROOT);
        const slug = await applyTopic(concept, topic, ROOT, lineage);
        console.log(`[topic] authored "${concept}" -> ${slug} (${topic.shape})`);
        return send(res, 200, { slug, label: topic.label, shape: topic.shape });
      } catch (e) {
        return send(res, 422, { error: String(e && e.message ? e.message : e) });
      }
    }

    // Stream a whole-topic authoring run (live Claude terminal).
    if (req.method === "GET" && url.pathname === "/api/topics/stream") {
      const sse = sseInit(res);
      const concept = String(url.searchParams.get("concept") || "").trim();
      if (!concept) {
        sse.send("failed", { error: "concept required" });
        return sse.end();
      }
      // Optional lineage: a sub-game authored FROM a parent topic's subtopic.
      const lineage = {
        parent: url.searchParams.get("parent") || undefined,
        fromConcept: url.searchParams.get("fromConcept") || undefined,
      };
      (async () => {
        try {
          const topic = await authorTopic(concept, ROOT, {
            onLog: (text) => sse.send("log", { text }),
            onText: (text) => sse.send("text", { text }),
          });
          sse.send("log", { text: "▸ Writing content files…" });
          const slug = await applyTopic(concept, topic, ROOT, lineage);
          sse.send("log", { text: `✓ Wrote content/${slug}/ and updated domains.json` });
          sse.send("done", { slug, label: topic.label, shape: topic.shape });
        } catch (e) {
          sse.send("failed", { error: String(e && e.message ? e.message : e) });
        } finally {
          sse.end();
        }
      })();
      return;
    }

    // Stream a self-heal authoring run for one ticket (live Claude terminal).
    const sm = url.pathname.match(/^\/api\/tickets\/([^/]+)\/author\/stream$/);
    if (req.method === "GET" && sm) {
      const sse = sseInit(res);
      (async () => {
        const t = await getTicket(decodeURIComponent(sm[1]));
        if (!t) {
          sse.send("failed", { error: "no such ticket" });
          return sse.end();
        }
        if (t.status === "done") {
          sse.send("done", { nodeId: t.nodeId, authoredBy: t.authoredBy });
          return sse.end();
        }
        t.status = "authoring";
        await save(t);
        try {
          const { authored, authoredBy } = await authorNode(t, ROOT, {
            onLog: (text) => sse.send("log", { text }),
            onText: (text) => sse.send("text", { text }),
          });
          sse.send("log", { text: `▸ Inserting node into content/${t.domain || t.shape}/…` });
          const nodeId = await applyAuthored(t.domain || t.shape, authored, ROOT);
          Object.assign(t, { status: "done", nodeId, authoredBy });
          await save(t);
          sse.send("done", { nodeId, authoredBy });
        } catch (e) {
          Object.assign(t, { status: "failed", error: String(e) });
          await save(t);
          sse.send("failed", { error: String(e && e.message ? e.message : e) });
        } finally {
          sse.end();
        }
      })();
      return;
    }

    const m = url.pathname.match(/^\/api\/tickets\/([^/]+)\/author$/);
    if (req.method === "POST" && m) {
      const t = await getTicket(decodeURIComponent(m[1]));
      if (!t) return send(res, 404, { error: "no such ticket" });
      if (t.status === "done") return send(res, 200, { ticket: t, node: { id: t.nodeId }, authoredBy: t.authoredBy });
      t.status = "authoring";
      await save(t);
      try {
        const { authored, authoredBy } = await authorNode(t, ROOT);
        const nodeId = await applyAuthored(t.domain || t.shape, authored, ROOT);
        Object.assign(t, { status: "done", nodeId, authoredBy });
        await save(t);
        console.log(`[heal] authored ${nodeId} for gap "${t.gap}" via ${authoredBy}`);
        return send(res, 200, { ticket: t, node: authored.node, authoredBy });
      } catch (e) {
        Object.assign(t, { status: "failed", error: String(e) });
        await save(t);
        return send(res, 500, { error: String(e) });
      }
    }

    const del = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
    if (req.method === "DELETE" && del) {
      let id;
      try {
        id = safeSegment(decodeURIComponent(del[1]), "ticket id");
      } catch (e) {
        return send(res, 400, { error: String(e.message) });
      }
      try {
        await unlink(path.join(QUEUE, `${id}.json`));
      } catch {
        /* already gone */
      }
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: "not found", hint: "This is the API server. Open the game at the Vite dev URL (default http://localhost:5173)." });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
});

// Bind to the preferred port, scanning upward past any that are already in use.
function listenOnFreePort(preferred, maxTries = 25) {
  return new Promise((resolve, reject) => {
    let port = preferred;
    let tries = 0;
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (e) => {
      if (e.code === "EADDRINUSE" && tries < maxTries) {
        tries += 1;
        port += 1;
        server.listen(port);
      } else {
        cleanup();
        reject(e);
      }
    };
    const onListening = () => {
      cleanup();
      resolve(server.address().port);
    };
    server.on("error", onError);
    server.on("listening", onListening);
    server.listen(port);
  });
}

const boundPort = await listenOnFreePort(PREFERRED_PORT);
console.log(`🎫 Concept Quest authoring server → http://localhost:${boundPort}  (queue: ${QUEUE})`);
if (boundPort !== PREFERRED_PORT) {
  console.log(`   (preferred port ${PREFERRED_PORT} was busy — using ${boundPort})`);
  console.log(`   point a standalone dev server here with:  CQ_SERVER_PORT=${boundPort} npm run dev`);
}
