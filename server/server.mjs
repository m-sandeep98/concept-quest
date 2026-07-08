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
const PORT = Number(process.env.PORT) || 8787;

await mkdir(QUEUE, { recursive: true });

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
  try {
    return JSON.parse(await readFile(path.join(QUEUE, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

function send(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

// Server-Sent Events: stream authoring logs + Claude's live output to the browser.
function sseInit(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
    "x-accel-buffering": "no",
  });
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
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api")) {
      return send(res, 200, {
        service: "Concept Quest authoring server",
        note: "This is the API only — open the game at http://localhost:5173",
        endpoints: ["GET /api/health", "GET /api/tickets", "POST /api/tickets", "POST /api/tickets/:id/author", "DELETE /api/tickets/:id"],
      });
    }
    if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/api/tickets") return send(res, 200, await listTickets());

    if (req.method === "POST" && url.pathname === "/api/tickets") {
      const body = await readBody(req);
      if (!body.shape) return send(res, 400, { error: "shape required" });
      const domain = body.domain || body.shape;
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
      try {
        await unlink(path.join(QUEUE, `${decodeURIComponent(del[1])}.json`));
      } catch {
        /* already gone */
      }
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: "not found", hint: "This is the API server. Open the game at http://localhost:5173" });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(
      `✗ Port ${PORT} is already in use — another authoring server is probably still running.\n` +
        `  Stop it:   lsof -ti :${PORT} | xargs kill\n` +
        `  Or use another port:   PORT=8788 npm run server   (then update the Vite proxy in vite.config.ts to match)`
    );
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => console.log(`🎫 Concept Quest authoring server → http://localhost:${PORT}  (queue: ${QUEUE})`));
