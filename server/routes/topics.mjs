// Whole-topic authoring routes: turn a bare concept into a new playable domain
// (graph.json + themes), streaming or blocking.

import { send, sseInit, readBody } from "../http.mjs";
import { authorTopic, applyTopic } from "../author.mjs";

export default async function topicRoutes(req, res, url, { root }) {
  if (req.method === "POST" && url.pathname === "/api/topics") {
    const body = await readBody(req);
    const concept = String(body.concept || "").trim();
    if (!concept) {
      send(res, 400, { error: "concept required" });
      return true;
    }
    const lineage = { parent: body.parent || undefined, fromConcept: body.fromConcept || undefined };
    try {
      const topic = await authorTopic(concept, root);
      const slug = await applyTopic(concept, topic, root, lineage);
      console.log(`[topic] authored "${concept}" -> ${slug} (${topic.shape})`);
      send(res, 200, { slug, label: topic.label, shape: topic.shape });
    } catch (e) {
      send(res, 422, { error: String(e && e.message ? e.message : e) });
    }
    return true;
  }

  // Stream a whole-topic authoring run (live Claude terminal).
  if (req.method === "GET" && url.pathname === "/api/topics/stream") {
    const sse = sseInit(res);
    const concept = String(url.searchParams.get("concept") || "").trim();
    if (!concept) {
      sse.send("failed", { error: "concept required" });
      sse.end();
      return true;
    }
    // Optional lineage: a sub-game authored FROM a parent topic's subtopic.
    const lineage = {
      parent: url.searchParams.get("parent") || undefined,
      fromConcept: url.searchParams.get("fromConcept") || undefined,
    };
    (async () => {
      try {
        const topic = await authorTopic(concept, root, {
          onLog: (text) => sse.send("log", { text }),
          onText: (text) => sse.send("text", { text }),
        });
        sse.send("log", { text: "▸ Writing content files…" });
        const slug = await applyTopic(concept, topic, root, lineage);
        sse.send("log", { text: `✓ Wrote content/${slug}/ and updated domains.json` });
        sse.send("done", { slug, label: topic.label, shape: topic.shape });
      } catch (e) {
        sse.send("failed", { error: String(e && e.message ? e.message : e) });
      } finally {
        sse.end();
      }
    })();
    return true;
  }

  return false;
}
