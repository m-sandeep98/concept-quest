import { useEffect, useRef, useState } from "react";
import { deleteTicket, listTickets, postTicket, type ServerTicket } from "./tickets";

// A plausible gap per archetype, for the "seed test gap" demo button.
const SEED: Record<string, { gap: string; spec: string; source: string }> = {
  "character-descent": { gap: "recursive case", spec: "shrinking-drill", source: "demo" },
  "binary-search": { gap: "halve the range", spec: "narrow-drill", source: "demo" },
};

export default function Kanban({
  domain,
  shape,
  onAuthor,
}: {
  domain: string;
  shape: string;
  // Streams the authoring run into the terminal + reloads; resolves when done.
  onAuthor: (id: string) => Promise<unknown>;
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

  // Serialized by busyRef so parallel claude runs can't race on the content files.
  async function authorOne(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(id);
    try {
      await onAuthor(id);
    } catch {
      /* error shows in terminal + ticket status */
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
      const mine = (await listTickets()).filter((t) => t.domain === domain);
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
  }, [domain]);

  function toggleAuto() {
    const v = !auto;
    setAuto(v);
    autoRef.current = v;
    if (v) maybePump(tickets);
  }

  async function seed() {
    const s = SEED[shape];
    if (s) {
      await postTicket(domain, shape, { ...s, kind: "generate" });
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
        🎫 Authoring server offline — run <code>npm run server</code> in a second terminal to enable the self-heal kanban and new topics.
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
        <span className="kanban-title">Claude Code authors content from your gaps — watch it in the Claude Terminal tab</span>
        <div className="kanban-tools">
          <label className={`auto-toggle ${auto ? "on" : ""}`}>
            <input type="checkbox" checked={auto} onChange={toggleAuto} /> Auto-author
          </label>
          {SEED[shape] && (
            <button className="ktool" onClick={seed}>
              ＋ seed test gap
            </button>
          )}
          <button className="ktool" onClick={clearDone}>
            clear done
          </button>
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
                    <span>
                      ✓ {t.authoredBy} → {t.nodeId}
                    </span>
                    <button className="kx" title="dismiss" onClick={() => deleteTicket(t.id).then(refresh)}>
                      ×
                    </button>
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
