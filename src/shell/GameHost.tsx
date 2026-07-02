import type { ReactNode } from "react";
import type { GameModule, GraphNode, Theme, ThemeNode } from "../types";

interface Props {
  node: GraphNode;
  theme: Theme;
  gameModule?: GameModule;
  onSignal: (tag: string) => void;
  onComplete: () => void;
  onExit: () => void;
  onEscapeHatch: () => void;
}

export default function GameHost({ node, theme, gameModule, onSignal, onComplete, onExit, onEscapeHatch }: Props) {
  const tn = theme.nodes[node.id];

  let body: ReactNode;
  if (!gameModule) {
    body = <div className="gh-error">No archetype registered for shape “{node.shape}”.</div>;
  } else {
    try {
      const level = gameModule.validate(node.level);
      const Game = gameModule.component;
      body = (
        <Game
          level={level}
          theme={theme}
          themeNode={tn}
          onSignal={onSignal}
          onComplete={(r) => {
            if (r.won) onComplete();
          }}
        />
      );
    } catch (e) {
      body = <div className="gh-error">Invalid level data: {String(e)}</div>;
    }
  }

  return <Shell node={node} tn={tn} onExit={onExit} onEscapeHatch={onEscapeHatch}>{body}</Shell>;
}

function Shell({
  node,
  tn,
  onExit,
  onEscapeHatch,
  children,
}: {
  node: GraphNode;
  tn?: ThemeNode;
  onExit: () => void;
  onEscapeHatch: () => void;
  children: ReactNode;
}) {
  return (
    <div className="gamehost">
      <div className="gh-top">
        <button className="gh-back" onClick={onExit}>
          ← Map
        </button>
        <button className="gh-stuck" onClick={onEscapeHatch}>
          🤔 I don't get this
        </button>
      </div>
      <h2 className="gh-title">{tn?.title ?? node.concept}</h2>
      {tn?.hook && <p className="gh-hook">{tn.hook}</p>}
      {children}
    </div>
  );
}
