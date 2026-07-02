import { useEffect, useState } from "react";
import { authorTicket, listTickets, type ServerTicket } from "./tickets";

export default function HealQueue({ shape, onAuthored }: { shape: string; onAuthored: (nodeId: string) => void }) {
  const [tickets, setTickets] = useState<ServerTicket[]>([]);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    try {
      const all = await listTickets();
      setTickets(all.filter((t) => t.shape === shape));
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  async function author(id: string) {
    setBusy(id);
    try {
      const res = await authorTicket(id);
      await refresh();
      if (res?.node?.id) onAuthored(res.node.id);
    } catch {
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!online) {
    return (
      <div className="heal offline">
        🎫 Authoring server offline — run <code>npm run server</code> in a second terminal to enable the live self-heal loop.
      </div>
    );
  }
  if (tickets.length === 0) return null;

  return (
    <div className="heal">
      <div className="heal-title">🎫 Self-heal queue — Claude Code authors new content from your gaps</div>
      <div className="heal-rows">
        {tickets.map((t) => (
          <div key={t.id} className={`heal-row ${t.status}`}>
            <div className="heal-main">
              <code>generate:{t.spec || t.gap}</code>
              <span className="heal-gap">gap: {t.gap} · from {t.source}</span>
            </div>
            <div className="heal-act">
              {t.status === "todo" && (
                <button className="heal-btn" disabled={busy === t.id} onClick={() => author(t.id)}>
                  {busy === t.id ? "authoring…" : "⚙ Author with Claude Code"}
                </button>
              )}
              {t.status === "authoring" && <span className="heal-status">authoring…</span>}
              {t.status === "done" && (
                <span className="heal-status ok">✓ authored by {t.authoredBy} → {t.nodeId}</span>
              )}
              {t.status === "failed" && <span className="heal-status bad">✕ failed</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
