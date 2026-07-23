// The `claude -p` invocation layer + model-output parsing. Everything that shells out to the
// Claude CLI lives here; the rest of the authoring pipeline consumes plain strings / JSON.

import { spawn } from "node:child_process";

// ---------- the real Claude Code invocation ----------

export function runClaude(prompt, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill("SIGKILL");
        reject(new Error("claude timed out"));
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`claude exited ${code}: ${err.slice(0, 200)}`));
      else resolve(out);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON object in claude output");
  return JSON.parse(body.slice(start, end + 1));
}

// Streaming variant of runClaude: emits token deltas + lifecycle logs while
// Claude generates, and resolves with the final result text. Drives the live
// "Claude terminal". Uses --output-format stream-json (newline-delimited JSON).
export function runClaudeStream(prompt, { onText, onLog } = {}, timeoutMs = 300000) {
  return streamClaude(
    ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"],
    prompt,
    { onText, onLog },
    timeoutMs
  );
}

// The shared streaming core: spawn `claude` with the given argv, feed it the prompt on stdin,
// translate the newline-delimited event stream into onText/onLog callbacks, and resolve with
// the final result text. Both the authoring runs and the doubt-chat ride this.
function streamClaude(args, prompt, { onText, onLog } = {}, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let finalText = "";
    let err = "";
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill("SIGKILL");
        reject(new Error("claude timed out"));
      }
    }, timeoutMs);

    function handle(ev) {
      if (ev.type === "system" && ev.subtype === "init") onLog?.("● Claude Code session started");
      else if (
        ev.type === "stream_event" &&
        ev.event?.type === "content_block_delta" &&
        ev.event.delta?.type === "text_delta"
      )
        onText?.(ev.event.delta.text);
      else if (ev.type === "system" && ev.subtype === "api_retry") onLog?.("… rate-limited, retrying");
      else if (ev.type === "result" && ev.subtype === "success" && typeof ev.result === "string") {
        finalText = ev.result;
        const cost = ev.total_cost_usd != null ? ` · $${Number(ev.total_cost_usd).toFixed(4)}` : "";
        onLog?.(`● generation complete${cost}`);
      }
    }

    // Buffer bytes and split on newlines so events never straddle chunk boundaries.
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          handle(JSON.parse(line));
        } catch {
          /* skip non-JSON / partial */
        }
      }
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (buf.trim()) {
        try {
          handle(JSON.parse(buf));
        } catch {
          /* ignore */
        }
      }
      if (code !== 0) reject(new Error(`claude exited ${code}: ${err.slice(0, 200)}`));
      else if (!finalText) reject(new Error("claude produced no result"));
      else resolve(finalText);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---------- the persistent doubt-chat session ----------
//
// The tutor is ONE long-lived Claude Code session per topic, not a fresh call per question.
// Claude Code persists sessions to disk, so continuity is achieved by id, not by a resident
// process: the first turn MINTS the session (`--session-id <uuid>`, a uuid we own), every
// later turn RESUMES it (`--resume <uuid>`). The conversation therefore survives page
// reloads, server restarts, and long gaps — a permanent session without a permanent process.
//
// The tutor is deliberately tool-less: it explains, it does not act. Denying the filesystem
// and network tools keeps a learner-facing chat from wandering the repo or the web, so the
// only thing it can do is answer in words.
const CHAT_DENIED_TOOLS = [
  "Bash", "Edit", "Write", "NotebookEdit", "Read", "Glob", "Grep",
  "Task", "WebFetch", "WebSearch", "TodoWrite",
].join(",");

export function runClaudeChatStream(
  prompt,
  { sessionId, resume = false, systemPrompt, onText, onLog } = {},
  timeoutMs = 180000
) {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    // Mint on the first turn, resume on every turn after it.
    ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]),
    "--disallowed-tools", CHAT_DENIED_TOOLS,
  ];
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  return streamClaude(args, prompt, { onText, onLog }, timeoutMs);
}

// Model calls that output a raw file (not JSON) fence their code; strip the fence.
export function stripFences(s) {
  const t = String(s ?? "").trim();
  const m = t.match(/^```[a-zA-Z0-9]*\s*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}
