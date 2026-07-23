// Self-heal ticket routes: the queue the game POSTs gaps into, and the two ways to fulfil
// one (streaming for the live terminal, blocking for scripts/curl).

import { send, sseInit, readBody, safeSegment } from "../http.mjs";
import { authorNode, applyAuthored } from "../author.mjs";
import {
  listTickets,
  saveTicket,
  getTicket,
  deleteTicket,
  findOpenDuplicate,
  newTicket,
} from "../tickets.mjs";

export default async function ticketRoutes(req, res, url, { root }) {
  if (req.method === "GET" && url.pathname === "/api/tickets") {
    send(res, 200, await listTickets(root));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/tickets") {
    const body = await readBody(req);
    if (!body.shape) {
      send(res, 400, { error: "shape required" });
      return true;
    }
    let domain;
    try {
      safeSegment(body.shape, "shape");
      domain = safeSegment(body.domain || body.shape, "domain");
    } catch (e) {
      send(res, 400, { error: String(e.message) });
      return true;
    }
    const open = findOpenDuplicate(await listTickets(root), { domain, gap: body.gap, spec: body.spec });
    if (open) {
      send(res, 200, open);
      return true;
    }
    const t = newTicket(body, domain);
    await saveTicket(root, t);
    send(res, 201, t);
    return true;
  }

  // Stream a self-heal authoring run for one ticket (live Claude terminal).
  const sm = url.pathname.match(/^\/api\/tickets\/([^/]+)\/author\/stream$/);
  if (req.method === "GET" && sm) {
    const sse = sseInit(res);
    (async () => {
      const t = await getTicket(root, decodeURIComponent(sm[1]));
      if (!t) {
        sse.send("failed", { error: "no such ticket" });
        return sse.end();
      }
      if (t.status === "done") {
        sse.send("done", { nodeId: t.nodeId, authoredBy: t.authoredBy });
        return sse.end();
      }
      t.status = "authoring";
      await saveTicket(root, t);
      try {
        const { authored, authoredBy } = await authorNode(t, root, {
          onLog: (text) => sse.send("log", { text }),
          onText: (text) => sse.send("text", { text }),
        });
        sse.send("log", { text: `▸ Inserting node into content/${t.domain || t.shape}/…` });
        const nodeId = await applyAuthored(t.domain || t.shape, authored, root);
        Object.assign(t, { status: "done", nodeId, authoredBy });
        await saveTicket(root, t);
        sse.send("done", { nodeId, authoredBy });
      } catch (e) {
        Object.assign(t, { status: "failed", error: String(e) });
        await saveTicket(root, t);
        sse.send("failed", { error: String(e && e.message ? e.message : e) });
      } finally {
        sse.end();
      }
    })();
    return true;
  }

  const m = url.pathname.match(/^\/api\/tickets\/([^/]+)\/author$/);
  if (req.method === "POST" && m) {
    const t = await getTicket(root, decodeURIComponent(m[1]));
    if (!t) {
      send(res, 404, { error: "no such ticket" });
      return true;
    }
    if (t.status === "done") {
      send(res, 200, { ticket: t, node: { id: t.nodeId }, authoredBy: t.authoredBy });
      return true;
    }
    t.status = "authoring";
    await saveTicket(root, t);
    try {
      const { authored, authoredBy } = await authorNode(t, root);
      const nodeId = await applyAuthored(t.domain || t.shape, authored, root);
      Object.assign(t, { status: "done", nodeId, authoredBy });
      await saveTicket(root, t);
      console.log(`[heal] authored ${nodeId} for gap "${t.gap}" via ${authoredBy}`);
      send(res, 200, { ticket: t, node: authored.node, authoredBy });
    } catch (e) {
      Object.assign(t, { status: "failed", error: String(e) });
      await saveTicket(root, t);
      send(res, 500, { error: String(e) });
    }
    return true;
  }

  const del = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
  if (req.method === "DELETE" && del) {
    try {
      await deleteTicket(root, decodeURIComponent(del[1]));
    } catch (e) {
      send(res, 400, { error: String(e.message) });
      return true;
    }
    send(res, 200, { ok: true });
    return true;
  }

  return false;
}
