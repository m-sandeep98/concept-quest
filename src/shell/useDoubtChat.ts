import { useCallback, useEffect, useRef, useState } from "react";

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  text: string;
  at: number;
}

/** Where the player is standing, so the tutor answers in context instead of asking. */
export interface ChatContext {
  topic?: string;
  shape?: string;
  subject?: string;
  concept?: string;
  nodeTitle?: string;
  where?: string;
}

export type ChatStatus = "idle" | "loading" | "streaming" | "error" | "offline";

// The question rides in the querystring (EventSource is GET-only). Local URLs handle a few KB
// comfortably; cap well under that so a pasted wall of text fails here with a clear message
// rather than as an opaque 431 from the server.
export const MAX_QUESTION = 2000;

/**
 * Drives the doubt-chat: one PERMANENT Claude Code session per topic, held server-side.
 *
 * The browser never calls an LLM — it POSTs nothing and holds no key. It asks the local
 * authoring server, which resumes the topic's session by id. History is re-fetched when the
 * topic changes, so reopening the drawer (or reloading the page) repaints the conversation.
 */
export function useDoubtChat(thread: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(""); // the answer currently streaming in
  const esRef = useRef<EventSource | null>(null);

  // Close any live stream when the thread changes or the app unmounts, so a topic switch
  // mid-answer can't leak a connection or land text in the wrong conversation.
  const stop = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    stop();
    setMessages([]);
    setPending("");
    setError(null);
    if (!thread) return;
    setStatus("loading");
    fetch(`/api/chat/${encodeURIComponent(thread)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`history ${r.status}`))))
      .then((d: { messages?: ChatMessage[] }) => {
        if (cancelled) return;
        setMessages(Array.isArray(d.messages) ? d.messages : []);
        setStatus("idle");
      })
      .catch(() => {
        // No server → the game still plays; the chat just says so.
        if (!cancelled) setStatus("offline");
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [thread, stop]);

  const ask = useCallback(
    (question: string, ctx: ChatContext) => {
      const q = question.trim();
      if (!q || !thread) return;
      if (q.length > MAX_QUESTION) {
        setError(`That question is too long (${q.length}/${MAX_QUESTION} characters).`);
        setStatus("error");
        return;
      }
      stop();
      setError(null);
      setPending("");
      setStatus("streaming");
      setMessages((prev) => [...prev, { role: "user", text: q, at: Date.now() }]);

      const params = new URLSearchParams({ q });
      for (const [k, v] of Object.entries(ctx)) if (v) params.set(k, v);
      const es = new EventSource(`/api/chat/${encodeURIComponent(thread)}/stream?${params}`);
      esRef.current = es;
      let settled = false;
      let acc = "";

      es.addEventListener("text", (e) => {
        acc += JSON.parse((e as MessageEvent).data).text;
        setPending(acc);
      });
      // The server dropped a stale session and is retrying — throw away the partial answer
      // so the retry doesn't get appended to a truncated one.
      es.addEventListener("reset", () => {
        acc = "";
        setPending("");
      });
      es.addEventListener("done", (e) => {
        settled = true;
        es.close();
        esRef.current = null;
        const { text } = JSON.parse((e as MessageEvent).data) as { text: string };
        setMessages((prev) => [...prev, { role: "assistant", text: text || acc, at: Date.now() }]);
        setPending("");
        setStatus("idle");
      });
      es.addEventListener("failed", (e) => {
        settled = true;
        es.close();
        esRef.current = null;
        setError(JSON.parse((e as MessageEvent).data).error || "the tutor couldn't answer");
        setPending("");
        setStatus("error");
      });
      es.onerror = () => {
        if (settled) return;
        settled = true;
        es.close();
        esRef.current = null;
        setError("connection lost — is the authoring server running? (npm run server)");
        setPending("");
        setStatus("error");
      };
    },
    [thread, stop]
  );

  // Forget the conversation AND the session behind it; the next question starts clean.
  const reset = useCallback(async () => {
    stop();
    setPending("");
    setError(null);
    setStatus("idle");
    setMessages([]);
    try {
      await fetch(`/api/chat/${encodeURIComponent(thread)}`, { method: "DELETE" });
    } catch {
      setStatus("offline");
    }
  }, [thread, stop]);

  return {
    messages,
    pending,
    status,
    error,
    busy: status === "streaming",
    offline: status === "offline",
    ask,
    reset,
  };
}
