import type { GraphNode } from "../types";

export interface Gap {
  gap: string;
  remediation: string;
  source: string;
}

export interface Ticket {
  spec: string;
  gap: string;
  source: string;
  kind: "generate" | "manual";
}

export interface Progress {
  mastered: string[];
  tagCounts: Record<string, Record<string, number>>;
  gaps: Gap[];
  surfaced: string[];
  tickets: Ticket[];
}

export function freshProgress(): Progress {
  return { mastered: [], tagCounts: {}, gaps: [], surfaced: [], tickets: [] };
}

/** Record one gap signal emitted from a play state. */
export function applySignal(p: Progress, nodeId: string, tag: string): Progress {
  const counts = { ...(p.tagCounts[nodeId] ?? {}) };
  counts[tag] = (counts[tag] ?? 0) + 1;
  return { ...p, tagCounts: { ...p.tagCounts, [nodeId]: counts } };
}

function parseRemediation(remediation: string): { kind: "sidequest" | "generate"; target: string } {
  const [kind, ...rest] = remediation.split(":");
  return { kind: kind as "sidequest" | "generate", target: rest.join(":") };
}

/**
 * Mastering a node: mark it done, clear any gap it remediates, then evaluate its
 * failure modes against accumulated signals and route remediation (surface a
 * sidequest, or emit a Claude Code ticket).
 */
export function applyComplete(p: Progress, node: GraphNode): { progress: Progress; newTicket?: Ticket } {
  const mastered = p.mastered.includes(node.id) ? p.mastered : [...p.mastered, node.id];
  const gaps = node.clearsGap ? p.gaps.filter((g) => g.gap !== node.clearsGap) : [...p.gaps];
  const surfaced = [...p.surfaced];
  const tickets = [...p.tickets];
  let newTicket: Ticket | undefined;

  const counts = p.tagCounts[node.id] ?? {};
  for (const fm of node.failureModes) {
    if ((counts[fm.signal.tag] ?? 0) < fm.signal.minCount) continue;
    const { kind, target } = parseRemediation(fm.remediation);
    const gapExists = gaps.some((g) => g.gap === fm.gap && g.remediation === fm.remediation);

    if (kind === "sidequest") {
      if (!surfaced.includes(target)) surfaced.push(target);
      if (!gapExists) gaps.push({ gap: fm.gap, remediation: fm.remediation, source: node.id });
    } else {
      if (!tickets.some((t) => t.spec === target)) {
        newTicket = { spec: target, gap: fm.gap, source: node.id, kind: "generate" };
        tickets.push(newTicket);
      }
      if (!gapExists) gaps.push({ gap: fm.gap, remediation: fm.remediation, source: node.id });
    }
  }
  return { progress: { ...p, mastered, gaps, surfaced, tickets }, newTicket };
}

/** The learner's manual "I don't get this" escape hatch → a CC ticket. */
export function addManualTicket(p: Progress, node: GraphNode): { progress: Progress; ticket: Ticket } {
  const ticket: Ticket = {
    spec: `reinforce-${node.concept.replace(/\s+/g, "-")}`,
    gap: node.concept,
    source: node.id,
    kind: "manual",
  };
  return { progress: { ...p, tickets: [...p.tickets, ticket] }, ticket };
}

const storageKey = (shape: string, themeId: string) => `cq:progress:${shape}:${themeId}`;

export function loadProgress(shape: string, themeId: string): Progress {
  try {
    const raw = localStorage.getItem(storageKey(shape, themeId));
    if (raw) return { ...freshProgress(), ...(JSON.parse(raw) as Partial<Progress>) };
  } catch {
    /* ignore corrupt storage */
  }
  return freshProgress();
}

export function saveProgress(shape: string, themeId: string, p: Progress): void {
  try {
    localStorage.setItem(storageKey(shape, themeId), JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
