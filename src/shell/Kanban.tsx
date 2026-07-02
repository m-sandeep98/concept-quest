import { useEffect, useRef, useState } from "react";
import { authorTicket, deleteTicket, listTickets, postTicket, type ServerTicket } from "./tickets";

// A plausible gap per archetype, for the "seed test gap" demo button.
const SEED: Record<string, { gap: string; spec: string; source: string }> = {
  "recursive-descent": { gap: "recursive case", spec: "shrinking-drill", source: "demo" },
  sequence: { gap: "prerequisites", spec: "foundation-drill", source: "demo" },
};

export default function Kanban({
  shape,
  onAuthored,
}: {
  shape: string;
  onAuthored: (nodeId: string) => void | Promise<void>;
}) {
  const [tickets, setTickets] = useState<ServerTicket[]>([]);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const busyRef = useRef(false);
  const autoRef = useRef(false);

  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);

  // Author one ticket. Serialized by busyRef so parallel claude runs can't race
  // on the content files. Used by both the manual button and auto-author.
  async function authorOne(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(id);
    try {
      const res = await authorTicket(id);
      if (res?.node?.id) await onAuthored(res.node.id);
    } catch {
      /* status shows failed */
    } finally {
      busyRef.current = false;
      setBusy(null);
      await refresh();
    }
  }

  function maybePump(list: ServerTicket[]) {
    if (!autoRef.current || busyRef.current) return;
    const next = list.find((t) => t.status === "todo");
    if (next) void authorOne(next.id);
  }

  async function refresh() {
    try {
      const mine = (await listTickets()).filter((t) => t.shape === shape);
      setTickets(mine);
      setOnline(true);
      maybePump(mine);
    } catch {
      setOnline(false);
    }
  }

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 2500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  function toggleAuto() {
    const v = !auto;
    setAuto(v);
    autoRef.current = v;
    if (v) maybePump(tickets);
  }

  async function seed() {
    const s = SEED[shape];
    if (s) {
      await postTicket(shape, { ...s, kind: "generate" });
      await refresh();
    }
  }

  async function clearDone() {
    for (const t of tickets.filter((t) => t.status === "done")) await deleteTicket(t.id);
    await refresh();
  }

  if (!online) {
    return (
      <div className="kanban offline">
        🎫 Authoring server offline — run <code>npm run server</code> in a second terminal to enable the self-heal kanban.
      </div>
    );
  }

  const cols = [
    { key: "backlog", label: "Backlog", items: tickets.filter((t) => t.status === "todo" || t.status === "failed") },
    { key: "authoring", label: "Authoring", items: tickets.filter((t) => t.status === "authoring") },
    { key: "done", label: "Done", items: tickets.filter((t) => t.status === "done") },
  ];

  return (
    <div className="kanban">
      <div className="kanban-head">
        <span className="kanban-title">🎫 Self-heal kanban — Claude Code authors content from your gaps</span>
        <div className="kanban-tools">
          <label className={`auto-toggle ${auto ? "on" : ""}`}>
            <input type="checkbox" checked={auto} onChange={toggleAuto} /> Auto-author
          </label>
          <button className="ktool" onClick={seed}>＋ seed test gap</button>
          <button className="ktool" onClick={clearDone}>clear done</button>
        </div>
      </div>

      <div className="kanban-cols">
        {cols.map((c) => (
          <div key={c.key} className={`kcol ${c.key}`}>
            <div className="kcol-head">
              {c.label} <span className="kcount">{c.items.length}</span>
            </div>
            {c.items.length === 0 && <div className="kempty">—</div>}
            {c.items.map((t) => (
              <div key={t.id} className={`kcard ${t.status}`}>
                <code className="kspec">generate:{t.spec || t.gap}</code>
                <div className="kgap">
                  gap: {t.gap}
                  {t.source ? ` · ${t.source}` : ""}
                </div>
                {(t.status === "todo" || t.status === "failed") && (
                  <button className="kbtn" disabled={!!busy} onClick={() => authorOne(t.id)}>
                    {busy === t.id ? "authoring…" : t.status === "failed" ? "↻ Retry" : "⚙ Author with Claude Code"}
                  </button>
                )}
                {t.status === "authoring" && <div className="kstatus spin">authoring… (claude -p)</div>}
                {t.status === "done" && (
                  <div className="kstatus ok">
                    <span>✓ {t.authoredBy} → {t.nodeId}</span>
                    <button className="kx" title="dismiss" onClick={() => deleteTicket(t.id).then(refresh)}>×</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
