import type { Graph, GraphNode, Theme } from "../types";
import type { Progress, Ticket } from "./progress";

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
  onShowTicket: (ticket: Ticket) => void;
}

export default function QuestMap({ graph, theme, themes, progress, onOpen, onSwitchTheme, onReset, onShowTicket }: Props) {
  const visible = graph.nodes.filter((n) => statusOf(n, progress) !== "hidden");
  const tiers = [...new Set(visible.map((n) => n.tier))].sort((a, b) => b - a); // boss (highest tier) on top
  const hasGap = (node: GraphNode) => progress.gaps.some((g) => g.gap === node.concept);

  return (
    <div className="map">
      <div className="map-toolbar">
        <div className="theme-switch">
          <span className="ts-label">Same engine · same graph · pick a subject:</span>
          {themes.map((t) => (
            <button
              key={t.id}
              className={`ts-btn ${t.id === theme.id ? "on" : ""}`}
              onClick={() => onSwitchTheme(t.id)}
            >
              {t.visual.actorIcon} {t.label}
            </button>
          ))}
        </div>
        <button className="reset-btn" onClick={onReset}>
          Reset progress
        </button>
      </div>

      <p className="map-boss-hook">🏁 {theme.bossHook}</p>

      <div className="ladder">
        {tiers.map((tier) => (
          <div key={tier} className="tier">
            {visible
              .filter((n) => n.tier === tier)
              .map((node) => {
                const st = statusOf(node, progress);
                const tn = theme.nodes[node.id];
                return (
                  <button
                    key={node.id}
                    className={`node ${node.type} ${st}`}
                    disabled={st === "locked"}
                    onClick={() => onOpen(node.id)}
                  >
                    <span className="node-type">{node.type}</span>
                    <span className="node-title">{tn?.title ?? node.concept}</span>
                    <span className="node-concept">teaches: {node.concept}</span>
                    <span className="node-foot">
                      {st === "mastered" && <em className="badge ok">✓ mastered</em>}
                      {st === "locked" && <em className="badge lock">🔒 locked</em>}
                      {st === "active" && <em className="badge go">▶ play</em>}
                      {hasGap(node) && <em className="badge gap">⚠ gap</em>}
                    </span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>

      {progress.tickets.length > 0 && (
        <div className="tickets">
          <div className="tickets-title">🎫 Claude Code tickets · self-heal queue</div>
          {progress.tickets.map((t, i) => (
            <button key={i} className="ticket-row" onClick={() => onShowTicket(t)}>
              <code>generate:{t.kind === "manual" ? "learner-reported" : t.spec}</code> — gap: {t.gap} (from {t.source})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
