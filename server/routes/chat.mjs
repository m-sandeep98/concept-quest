// Doubt-chat routes: the learner's permanent Claude session, one thread per topic.
// Transport only — session continuity and the tutor's role live in ../chat.mjs.

import { send, sseInit, safeSegment } from "../http.mjs";
import { ask, loadThread, resetThread } from "../chat.mjs";

// Where the player is standing, forwarded to the tutor so answers land on the level in
// front of them rather than on the topic in general.
const CONTEXT_KEYS = ["topic", "shape", "subject", "concept", "nodeTitle", "where"];

export default async function chatRoutes(req, res, url, { root }) {
  // Stream one turn. Matched BEFORE the history route below (longer path first).
  const cs = url.pathname.match(/^\/api\/chat\/([^/]+)\/stream$/);
  if (req.method === "GET" && cs) {
    const sse = sseInit(res);
    let thread;
    try {
      thread = safeSegment(decodeURIComponent(cs[1]), "chat thread");
    } catch (e) {
      sse.send("failed", { error: String(e.message) });
      sse.end();
      return true;
    }
    const question = String(url.searchParams.get("q") || "").trim();
    if (!question) {
      sse.send("failed", { error: "question required" });
      sse.end();
      return true;
    }
    const ctx = {};
    for (const k of CONTEXT_KEYS) ctx[k] = url.searchParams.get(k) || undefined;

    (async () => {
      try {
        const { answer } = await ask(root, thread, question, ctx, {
          onText: (text) => sse.send("text", { text }),
          onLog: (text) => sse.send("log", { text }),
          onReset: () => sse.send("reset", {}),
        });
        sse.send("done", { text: answer });
      } catch (e) {
        sse.send("failed", { error: String(e && e.message ? e.message : e) });
      } finally {
        sse.end();
      }
    })();
    return true;
  }

  const ch = url.pathname.match(/^\/api\/chat\/([^/]+)$/);
  if (ch && (req.method === "GET" || req.method === "DELETE")) {
    let thread;
    try {
      thread = safeSegment(decodeURIComponent(ch[1]), "chat thread");
    } catch (e) {
      send(res, 400, { error: String(e.message) });
      return true;
    }
    // Repaint history on load — the transcript mirror, not the session's own memory.
    if (req.method === "GET") {
      const t = await loadThread(root, thread);
      send(res, 200, { thread: t.thread, started: t.started, messages: t.messages });
      return true;
    }
    // Forget the conversation and mint a fresh session on the next question.
    await resetThread(root, thread);
    send(res, 200, { ok: true });
    return true;
  }

  return false;
}
