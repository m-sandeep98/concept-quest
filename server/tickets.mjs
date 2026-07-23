// The self-heal ticket queue: one JSON file per ticket under server/queue/. Pure storage —
// the routes decide what a ticket means, author.mjs decides how to fulfil one.

import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { safeSegment } from "./http.mjs";

export const queueDir = (root) => path.join(root, "server", "queue");

export const ensureQueue = (root) => mkdir(queueDir(root), { recursive: true });

export async function listTickets(root) {
  const dir = queueDir(root);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await readFile(path.join(dir, f), "utf8")));
    } catch {
      /* skip corrupt */
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export const saveTicket = (root, t) =>
  writeFile(path.join(queueDir(root), `${t.id}.json`), JSON.stringify(t, null, 2));

export async function getTicket(root, id) {
  let safe;
  try {
    safe = safeSegment(id, "ticket id");
  } catch {
    return null; // malformed id -> treat as "no such ticket"
  }
  try {
    return JSON.parse(await readFile(path.join(queueDir(root), `${safe}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function deleteTicket(root, id) {
  const safe = safeSegment(id, "ticket id");
  try {
    await unlink(path.join(queueDir(root), `${safe}.json`));
  } catch {
    /* already gone */
  }
}

// Reuse an open ticket for the same gap in the same domain rather than piling up duplicates.
export const findOpenDuplicate = (tickets, { domain, gap, spec }) =>
  tickets.find((x) => x.domain === domain && x.gap === gap && x.spec === (spec || "") && x.status !== "done");

export const newTicket = (body, domain) => ({
  id: `t-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  domain,
  shape: body.shape,
  spec: body.spec || "",
  gap: body.gap || "",
  source: body.source || "",
  kind: body.kind || "generate",
  status: "todo",
  createdAt: Date.now(),
});
