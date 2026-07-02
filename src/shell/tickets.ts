// Client for the local authoring server. All calls are best-effort: if the
// server is offline, the game still plays — only the live self-heal loop pauses.

export interface ServerTicket {
  id: string;
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
  shape: string,
  t: { spec: string; gap: string; source: string; kind: string }
): Promise<void> {
  try {
    await fetch(`${API}/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shape, spec: t.spec, gap: t.gap, source: t.source, kind: t.kind }),
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
