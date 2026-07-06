import type { CSSProperties } from "react";
import type { Graph, GraphNode, Theme } from "../types";
import type { Progress } from "./progress";

type Status = "mastered" | "active" | "locked" | "hidden";

function statusOf(node: GraphNode, p: Progress): Status {
  if (p.mastered.includes(node.id)) return "mastered";
  if (node.type === "sidequest" && !p.surfaced.includes(node.id)) return "hidden";
  const unlocked =
    node.type === "sidequest" ? p.surfaced.includes(node.id) : node.prereqs.every((x) => p.mastered.includes(x));
  return unlocked ? "active" : "locked";
}

interface Props {
  graph: Graph;
  theme: Theme;
  themes: Theme[];
  progress: Progress;
  onOpen: (nodeId: string) => void;
  onSwitchTheme: (themeId: string) => void;
  onReset: () => void;
}

// A cubic S-curve between two points in the 0–100 percent coordinate space.
function edgePath(x1: number, y1: number, x2: number, y2: number) {
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

export default function QuestMap({ graph, theme, themes, progress, onOpen, onSwitchTheme, onReset }: Props) {
  const visible = graph.nodes.filter((n) => statusOf(n, progress) !== "hidden");
  // Highest tier (the boss) sits at the top; the entry level anchors the bottom.
  const tiers = [...new Set(visible.map((n) => n.tier))].sort((a, b) => b - a);
  const rows = tiers.length || 1;
  const hasGap = (node: GraphNode) => progress.gaps.some((g) => g.gap === node.concept);

  // Deterministic layout — every node gets a percent coordinate, so the edges
  // (drawn in the same space) line up without any DOM measurement.
  const pos = new Map<string, { x: number; y: number }>();
  tiers.forEach((tier, ri) => {
    const inTier = visible
      .filter((n) => n.tier === tier)
      .sort((a, b) => (a.type === "sidequest" ? 1 : 0) - (b.type === "sidequest" ? 1 : 0));
    const y = ((ri + 0.5) / rows) * 100;
    inTier.forEach((node, ci) => {
      pos.set(node.id, { x: ((ci + 1) / (inTier.length + 1)) * 100, y });
    });
  });

  // Build the edge list: prereq → node, plus a dashed "remediates" link for sidequests.
  const edges: { d: string; cls: string; key: string }[] = [];
  for (const node of visible) {
    const to = pos.get(node.id)!;
    const st = statusOf(node, progress);
    const cls = st === "active" ? "active" : st === "mastered" ? "mastered" : "locked";
    for (const pid of node.prereqs) {
      const from = pos.get(pid);
      if (from) edges.push({ key: `${pid}->${node.id}`, cls, d: edgePath(from.x, from.y, to.x, to.y) });
    }
    if (node.type === "sidequest" && node.remediates) {
      const target = pos.get(node.remediates);
      if (target) edges.push({ key: `${node.id}~>${node.remediates}`, cls: "side", d: edgePath(to.x, to.y, target.x, target.y) });
    }
  }

  return (
    <div className="mission">
      <div className="mission-bar">
        <div className="theme-switch">
          <span className="ts-label">Same graph · pick a subject</span>
          {themes.map((t) => (
            <button key={t.id} className={`ts-btn ${t.id === theme.id ? "on" : ""}`} onClick={() => onSwitchTheme(t.id)}>
              {t.visual.actorIcon} {t.label}
            </button>
          ))}
        </div>
        <button className="reset-btn" onClick={onReset}>
          ⟳ Reset progress
        </button>
      </div>

      <p className="mission-brief">
        <b>Mission</b>
        {theme.bossHook}
      </p>

      <div className="mission-map" style={{ "--rows": rows } as CSSProperties}>
        <svg className="mission-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {edges.map((e) => (
            <path key={e.key} className={e.cls} d={e.d} />
          ))}
        </svg>

        {visible.map((node, i) => {
          const st = statusOf(node, progress);
          const tn = theme.nodes[node.id];
          const p = pos.get(node.id)!;
          const style = { "--nx": `${p.x}%`, "--ny": `${p.y}%`, animationDelay: `${i * 55}ms` } as CSSProperties;
          return (
            <button
              key={node.id}
              className={`mission-node ${node.type} ${st}`}
              style={style}
              disabled={st === "locked"}
              onClick={() => onOpen(node.id)}
            >
              <span className="mn-type">{node.type}</span>
              <span className="mn-title">{tn?.title ?? node.concept}</span>
              <span className="mn-concept">teaches: {node.concept}</span>
              <span className="mn-foot">
                {st === "mastered" && <em className="badge ok">✓ mastered</em>}
                {st === "locked" && <em className="badge lock">🔒 locked</em>}
                {st === "active" && <em className="badge go">▶ play</em>}
                {hasGap(node) && <em className="badge gap">⚠ gap</em>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
