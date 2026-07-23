// The doubt-chat: a PERMANENT Claude Code session the learner can ask questions in,
// one thread per topic. This is the third offline seam (alongside self-heal and topic
// authoring) — still `claude -p`, still opt-in, still never touched at play-time by the
// game itself.
//
// "Permanent" is achieved by session id, not by a resident process. We mint a uuid, hand it
// to the CLI on the first turn (`--session-id`), and resume it on every turn after
// (`--resume`). Claude Code stores the conversation on disk, so the thread survives page
// reloads, server restarts, and overnight gaps. This file owns the id + a mirror of the
// transcript (so the UI can repaint history) — the conversational MEMORY lives in the
// session itself, which is why we never replay old turns into the prompt.

import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { runClaudeChatStream } from "./claude.mjs";

export const chatDir = (root) => path.join(root, "server", "chat");

// The transcript mirror is for repainting the UI, not for context — trim it so a long-lived
// thread can't grow unbounded on disk.
const MAX_MIRRORED = 200;

// The tutor's standing role, appended to Claude Code's system prompt on every turn of the
// session. Deliberately about *teaching the concept*, not about this repo: the learner is
// asking why recursion bottoms out, not how the archetype registry is wired.
const TUTOR_SYSTEM = [
  "You are the in-game tutor for Concept Quest, a game that teaches concepts by making the player enact them.",
  "The player is mid-learning and stuck. Answer the doubt they actually have.",
  "",
  "How to answer:",
  "- Lead with the answer in one or two plain sentences, then unpack it only as far as the question needs.",
  "- Stay inside the theme they are playing when it helps intuition (a wizard's well, nesting dolls), then name the abstract idea underneath it. The theme is the handle; the concept is the thing.",
  "- Prefer a concrete worked example over a definition.",
  "- Do NOT spoil the level's solution outright. Give the player the idea they are missing and let them make the move.",
  "- If the question has drifted off the topic, just answer it — a curious learner is still learning.",
  "- Plain prose. Short paragraphs. Markdown code fences only for actual code.",
  "",
  "You have no tools. You cannot read files, run commands, or browse. Answer from what you know and from the context given in the message.",
].join("\n");

const threadFile = (root, thread) => path.join(chatDir(root), `${thread}.json`);

const emptyThread = (thread) => ({
  thread,
  sessionId: randomUUID(),
  started: false, // has the session been minted yet? decides --session-id vs --resume
  messages: [],
  createdAt: Date.now(),
});

export async function loadThread(root, thread) {
  try {
    const t = JSON.parse(await readFile(threadFile(root, thread), "utf8"));
    // Tolerate a hand-edited / partially-written file rather than 500ing the chat.
    if (!t || typeof t.sessionId !== "string") return emptyThread(thread);
    return { ...emptyThread(thread), ...t, messages: Array.isArray(t.messages) ? t.messages : [] };
  } catch {
    return emptyThread(thread); // no thread yet — that's the normal first-visit path
  }
}

async function saveThread(root, t) {
  await mkdir(chatDir(root), { recursive: true });
  const trimmed = { ...t, messages: t.messages.slice(-MAX_MIRRORED) };
  await writeFile(threadFile(root, t.thread), JSON.stringify(trimmed, null, 2));
}

// Forget this topic's conversation entirely and start a fresh session next time.
export async function resetThread(root, thread) {
  try {
    await unlink(threadFile(root, thread));
  } catch {
    /* already gone */
  }
  return emptyThread(thread);
}

// Where the player is standing, folded into the turn so the tutor answers in context
// instead of asking "which level do you mean?". Sent every turn because the player moves
// around the map mid-conversation.
function contextBlock(ctx = {}) {
  const lines = [];
  if (ctx.topic) lines.push(`Topic: ${ctx.topic}`);
  if (ctx.shape) lines.push(`Archetype (the concept's shape): ${ctx.shape}`);
  if (ctx.subject) lines.push(`Theme they are playing: ${ctx.subject}`);
  if (ctx.concept) lines.push(`Current level teaches: ${ctx.concept}`);
  if (ctx.nodeTitle) lines.push(`Current level title: ${ctx.nodeTitle}`);
  if (ctx.where) lines.push(`They are on: ${ctx.where}`);
  if (!lines.length) return "";
  return [`<context>`, ...lines, `</context>`, ``].join("\n");
}

/**
 * Ask one question on a topic's permanent thread. Streams the answer out through `onText`
 * and resolves once the turn is stored.
 */
export async function ask(root, thread, question, ctx, { onText, onLog, onReset } = {}) {
  const t = await loadThread(root, thread);
  const prompt = `${contextBlock(ctx)}${question}`;

  let answer;
  try {
    answer = await runClaudeChatStream(prompt, {
      sessionId: t.sessionId,
      resume: t.started,
      systemPrompt: TUTOR_SYSTEM,
      onText,
      onLog,
    });
  } catch (e) {
    // A resume can fail if the stored session was pruned or the id went stale. Rather than
    // dead-ending the thread, mint a new session and retry once — the player loses the
    // model's memory of earlier turns, not the ability to ask.
    if (!t.started) throw e;
    // Discard anything the failed attempt already streamed, so the retry's answer doesn't
    // get concatenated onto a truncated one in the UI.
    onReset?.();
    onLog?.("… previous session unavailable, starting a fresh one");
    t.sessionId = randomUUID();
    t.started = false;
    answer = await runClaudeChatStream(prompt, {
      sessionId: t.sessionId,
      resume: false,
      systemPrompt: TUTOR_SYSTEM,
      onText,
      onLog,
    });
  }

  t.started = true;
  t.messages.push({ role: "user", text: question, at: Date.now() });
  t.messages.push({ role: "assistant", text: answer, at: Date.now() });
  await saveThread(root, t);
  return { answer, sessionId: t.sessionId };
}
