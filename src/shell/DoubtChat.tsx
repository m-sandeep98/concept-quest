import { useEffect, useRef, useState } from "react";
import type { ChatContext, ChatMessage, ChatStatus } from "./useDoubtChat";
import { MAX_QUESTION } from "./useDoubtChat";
// Aliased: `ChatMessage` above is the transcript TYPE; this is the component that renders one.
import ChatBubble from "./ChatMessage";

interface Props {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  pending: string;
  status: ChatStatus;
  error: string | null;
  busy: boolean;
  offline: boolean;
  onAsk: (q: string, ctx: ChatContext) => void;
  onReset: () => void;
  /** Where the player is standing — shown as the drawer's subtitle and sent with each turn. */
  context: ChatContext;
}

// Openers that turn a blank drawer into something clickable. Phrased as the doubts a stuck
// player actually has, not as feature names.
const STARTERS = [
  "I don't get what this level is really teaching",
  "Explain this concept like I've never seen it",
  "Why did my last attempt fail?",
  "Where does this show up in real code?",
];

/**
 * The doubt-chat drawer: a permanent Claude Code session, one thread per topic.
 *
 * Game-agnostic like the rest of the shell — it knows about a transcript and a context
 * blurb, never about an archetype. It overlays rather than resizes, so the PixiJS canvas
 * behind it keeps the dimensions its scene was laid out for.
 */
export default function DoubtChat({
  open,
  onClose,
  messages,
  pending,
  status,
  error,
  busy,
  offline,
  onAsk,
  onReset,
  context,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Follow the conversation as it streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Esc closes the drawer — but only when it isn't the game's own Esc to handle.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function submit(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    onAsk(q, context);
    setDraft("");
  }

  const subtitle = [placeLabel(context.topic, context.subject), context.nodeTitle].filter(Boolean).join(" · ");
  const empty = messages.length === 0 && !pending;

  return (
    <aside className={`doubt ${open ? "open" : ""}`} aria-hidden={!open} aria-label="Ask Claude">
      <header className="doubt-head">
        <div className="doubt-id">
          <span className="doubt-title">Ask Claude</span>
          {subtitle && <span className="doubt-sub">{subtitle}</span>}
        </div>
        <div className="doubt-actions">
          <span className={`doubt-state ${status}`}>{offline ? "offline" : busy ? "thinking" : "session"}</span>
          <button
            className="doubt-icon"
            onClick={onReset}
            disabled={busy || offline}
            title="Forget this conversation and start a new session"
          >
            ⟳
          </button>
          <button className="doubt-icon" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
      </header>

      <div className="doubt-body" ref={scrollRef}>
        {offline ? (
          <div className="doubt-offline">
            <p>The tutor runs on your local Claude account, through the authoring server.</p>
            <p>
              Start it with <code>npm run server</code> (or <code>npm run dev:all</code>) and reopen this drawer.
            </p>
            <p className="doubt-fine">The game itself plays fine without it.</p>
          </div>
        ) : (
          <>
            {empty && (
              <div className="doubt-empty">
                <p className="doubt-empty-lead">Stuck on something? Ask.</p>
                <p className="doubt-fine">
                  One continuous session per topic — it remembers what you asked earlier, across reloads.
                </p>
                <div className="doubt-starters">
                  {STARTERS.map((s) => (
                    <button key={s} className="doubt-starter" onClick={() => submit(s)} disabled={busy}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <ChatBubble key={`${m.at}-${i}`} role={m.role} text={m.text} />
            ))}
            {pending && <ChatBubble role="assistant" text={pending} streaming />}
            {busy && !pending && <div className="doubt-thinking">thinking…</div>}
            {status === "error" && error && <div className="doubt-error">✗ {error}</div>}
          </>
        )}
      </div>

      <form
        className="doubt-compose"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <textarea
          ref={inputRef}
          className="doubt-input"
          rows={1}
          value={draft}
          maxLength={MAX_QUESTION}
          placeholder={offline ? "start the server to ask…" : "ask about this level…"}
          disabled={offline}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter writes a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(draft);
            }
          }}
        />
        <button className="doubt-send" type="submit" disabled={busy || offline || !draft.trim()}>
          {busy ? "···" : "↵"}
        </button>
      </form>
    </aside>
  );
}

/**
 * The theme's subject usually restates the topic ("Recursion" → "Recursion (code)"). Show the
 * more specific one rather than both, so the header reads as a place, not a breadcrumb.
 */
function placeLabel(topic?: string, subject?: string) {
  if (!topic) return subject ?? "";
  if (!subject) return topic;
  // Compare on letters/digits only — topic labels carry an emoji prefix ("🌀 Recursion"),
  // which would otherwise defeat the containment check.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const a = norm(topic);
  const b = norm(subject);
  return a.includes(b) || b.includes(a) ? subject : `${topic} · ${subject}`;
}
