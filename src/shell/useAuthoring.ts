import { useEffect, useRef, useState } from "react";

export type TermEntry = { kind: "log" | "claude"; text: string };
export type AuthStatus = "idle" | "running" | "done" | "error";

// Drives the live "Claude terminal": opens an SSE stream to the authoring server,
// accumulates narration logs + Claude's streamed output, and resolves when the
// run finishes (so the caller can hot-reload the game).
export function useAuthoring() {
  const [entries, setEntries] = useState<TermEntry[]>([]);
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  function run(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      esRef.current?.close();
      setEntries([]);
      setError(null);
      setStatus("running");
      const es = new EventSource(url);
      esRef.current = es;
      let settled = false;

      es.addEventListener("log", (e) => {
        const { text } = JSON.parse((e as MessageEvent).data);
        setEntries((prev) => [...prev, { kind: "log", text }]);
      });
      es.addEventListener("text", (e) => {
        const { text } = JSON.parse((e as MessageEvent).data);
        setEntries((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === "claude") return [...prev.slice(0, -1), { kind: "claude", text: last.text + text }];
          return [...prev, { kind: "claude", text }];
        });
      });
      es.addEventListener("done", (e) => {
        settled = true;
        es.close();
        setStatus("done");
        resolve(JSON.parse((e as MessageEvent).data));
      });
      es.addEventListener("failed", (e) => {
        settled = true;
        es.close();
        const err = JSON.parse((e as MessageEvent).data).error || "authoring failed";
        setError(err);
        setStatus("error");
        reject(new Error(err));
      });
      es.onerror = () => {
        if (settled) return;
        settled = true;
        es.close();
        const err = "connection lost — is the authoring server running? (npm run server)";
        setError(err);
        setStatus("error");
        reject(new Error(err));
      };
    });
  }

  return {
    entries,
    status,
    error,
    running: status === "running",
    startTopic: (concept: string) => run(`/api/topics/stream?concept=${encodeURIComponent(concept)}`),
    startHeal: (id: string) => run(`/api/tickets/${encodeURIComponent(id)}/author/stream`),
  };
}
