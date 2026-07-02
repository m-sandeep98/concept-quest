// Client for the local authoring server. All calls are best-effort: if the
// server is offline, the game still plays — only authoring (self-heal + new
// topics) pauses.

export interface ServerTicket {
  id: string;
  domain: string;
  shape: string;
  spec: string;
  gap: string;
  source: string;
  kind: string;
  status: "todo" | "authoring" | "done" | "failed";
  nodeId?: string;
  authoredBy?: string;
  createdAt: number;
}

const API = "/api";

export async function postTicket(
  domain: string,
  shape: string,
  t: { spec: string; gap: string; source: string; kind: string }
): Promise<void> {
  try {
    await fetch(`${API}/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, shape, spec: t.spec, gap: t.gap, source: t.source, kind: t.kind }),
    });
  } catch {
    /* server offline — fine */
  }
}

export async function listTickets(): Promise<ServerTicket[]> {
  const r = await fetch(`${API}/tickets`);
  if (!r.ok) throw new Error("authoring server unavailable");
  return r.json();
}

export async function authorTicket(id: string): Promise<{ node: { id: string }; authoredBy: string }> {
  const r = await fetch(`${API}/tickets/${encodeURIComponent(id)}/author`, { method: "POST" });
  if (!r.ok) throw new Error("authoring failed");
  return r.json();
}

export async function deleteTicket(id: string): Promise<void> {
  try {
    await fetch(`${API}/tickets/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* server offline — fine */
  }
}

// Author a whole new playable topic from a bare concept.
export async function authorTopic(concept: string): Promise<{ slug: string; label: string; shape: string }> {
  const r = await fetch(`${API}/topics`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ concept }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "authoring failed — is the server running? (npm run server)");
  return data;
}
