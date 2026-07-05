import { useEffect, useRef } from "react";
import type { AuthStatus, TermEntry } from "./useAuthoring";

function logClass(text: string) {
  if (text.startsWith("✗")) return "bad";
  if (text.startsWith("✓")) return "ok";
  if (text.startsWith("●")) return "sys";
  return "";
}

export default function Terminal({
  entries,
  status,
  error,
}: {
  entries: TermEntry[];
  status: AuthStatus;
  error: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, status]);

  return (
    <div className="term">
      <div className="term-topbar">
        <span className="term-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="term-title">claude -p · headless authoring</span>
        <span className={`term-state ${status}`}>{status}</span>
      </div>
      <div className="term-body" ref={ref}>
        {entries.length === 0 && status === "idle" && (
          <div className="term-idle">
            Claude Code output streams here when you create a topic or author a drill.
            <br />
            Runs headlessly on your local Claude account.
          </div>
        )}
        {entries.map((en, i) =>
          en.kind === "log" ? (
            <div key={i} className={`term-log ${logClass(en.text)}`}>
              {en.text}
            </div>
          ) : (
            <pre key={i} className="term-claude">
              {en.text}
            </pre>
          )
        )}
        {status === "running" && <span className="term-cursor">▍</span>}
        {status === "error" && error && <div className="term-log bad">✗ {error}</div>}
      </div>
    </div>
  );
}
