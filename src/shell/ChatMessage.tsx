import type { ReactNode } from "react";

/**
 * One chat bubble, plus the markdown-lite it renders.
 *
 * Deliberately minimal — enough that a snippet reads as a snippet and `**bold**` doesn't leak
 * literal asterisks, without pulling a markdown dependency in for a chat drawer. Kept apart
 * from `DoubtChat` so the drawer stays about layout and the parsing stays unit-testable.
 */
export default function ChatMessage({
  role,
  text,
  streaming,
}: {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className={`doubt-msg ${role}`}>
      <span className="doubt-who">{role === "user" ? "you" : "claude"}</span>
      <div className="doubt-text">
        {blocks(text).map((seg, i) =>
          seg.code ? (
            <pre key={i} className="doubt-code">
              {seg.text}
            </pre>
          ) : (
            <p key={i}>{inline(seg.text)}</p>
          )
        )}
        {streaming && <span className="doubt-caret">▍</span>}
      </div>
    </div>
  );
}

/** Split an answer into prose and fenced-code blocks. */
export function blocks(text: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = [];
  const re = /```[a-zA-Z0-9]*\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const prose = text.slice(last, m.index).trim();
    if (prose) out.push({ code: false, text: prose });
    if (m[1].trim()) out.push({ code: true, text: m[1].replace(/\n$/, "") });
    last = re.lastIndex;
  }
  const tail = text.slice(last).trim();
  // An unterminated fence means the code block is still streaming in — show it as code.
  if (tail) {
    const openFence = tail.match(/```[a-zA-Z0-9]*\n?([\s\S]*)$/);
    if (openFence) {
      const before = tail.slice(0, openFence.index).trim();
      if (before) out.push({ code: false, text: before });
      if (openFence[1]) out.push({ code: true, text: openFence[1] });
    } else {
      out.push({ code: false, text: tail });
    }
  }
  return out.length ? out : [{ code: false, text }];
}

/** Resolve the inline markdown the model actually uses in prose — `code`, **bold**, *italic*. */
export function inline(text: string): ReactNode[] {
  // Constructed per call: a module-level /g regex carries lastIndex between calls.
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined)
      out.push(
        <code key={key++} className="doubt-inline">
          {m[1]}
        </code>
      );
    else if (m[2] !== undefined) out.push(<strong key={key++}>{m[2]}</strong>);
    else out.push(<em key={key++}>{m[3]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
