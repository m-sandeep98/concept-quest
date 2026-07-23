import { useRef, useState } from "react";
import type { ReactNode } from "react";
import type { GameModule, GraphNode, LearnBeats, Theme, ThemeNode } from "../types";

interface Props {
  node: GraphNode;
  theme: Theme;
  gameModule?: GameModule;
  onSignal: (tag: string) => void;
  onComplete: () => void;
  onExit: () => void;
  onEscapeHatch: () => void;
}

type Phase = "frame" | "play" | "reveal";

export default function GameHost({ node, theme, gameModule, onSignal, onComplete, onExit, onEscapeHatch }: Props) {
  const tn = theme.nodes[node.id];
  const learn = tn?.learn;

  // Phase machine: frame (pre-play primer, only if authored) → play (the game) → reveal (post-win).
  const [phase, setPhase] = useState<Phase>(() => (learn?.frame ? "frame" : "play"));
  // Accumulate every gap signal the game fired, so the reveal can reflect on the struggle.
  const firedTags = useRef<Set<string>>(new Set());

  // Wrap onSignal: record the tag locally AND forward it to the shell's real handler.
  function handleSignal(tag: string) {
    firedTags.current.add(tag);
    onSignal(tag);
  }

  // The game finished a genuine win. Show the reveal only when there's authored content to
  // justify it: a concreteness-fading reveal, or a struggle insight for a gap that actually
  // fired. Nodes with no `learn` data pass straight through — identical to pre-learning-loop
  // behavior, so the loop stays scoped to authored content and never leaks into other archetypes.
  function finishPlay() {
    const hasStumbleInsight = [...firedTags.current].some((tag) => learn?.insights?.[tag]);
    if (learn?.reveal || hasStumbleInsight) setPhase("reveal");
    else onComplete();
  }

  let body: ReactNode;
  if (phase === "frame") {
    body = <FrameCard text={learn?.frame ?? ""} onBegin={() => setPhase("play")} />;
  } else if (phase === "reveal") {
    body = (
      <RevealCard node={node} learn={learn} firedTags={firedTags.current} onContinue={onComplete} />
    );
  } else if (!gameModule) {
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
          onSignal={handleSignal}
          onComplete={(r) => {
            if (r.won) finishPlay();
          }}
        />
      );
    } catch (e) {
      body = <div className="gh-error">Invalid level data: {String(e)}</div>;
    }
  }

  return <Shell node={node} tn={tn} onExit={onExit} onEscapeHatch={onEscapeHatch}>{body}</Shell>;
}

function FrameCard({ text, onBegin }: { text: string; onBegin: () => void }) {
  return (
    <div className="gh-beat">
      <div className="gh-beat-eyebrow">before you begin</div>
      <p className="gh-beat-body">{text}</p>
      <div className="gh-beat-actions">
        <button className="rd-run" onClick={onBegin}>
          Begin ▶
        </button>
      </div>
    </div>
  );
}

function RevealCard({
  node,
  learn,
  firedTags,
  onContinue,
}: {
  node: GraphNode;
  learn?: LearnBeats;
  firedTags: Set<string>;
  onContinue: () => void;
}) {
  const reveal = learn?.reveal;
  const concept = reveal?.concept ?? node.concept;
  // Just-in-time explanations for the gaps that actually fired. Authored `insights` only — the
  // in-fiction `failText` was already shown mid-play, so re-showing it here would be redundant.
  const stumbles = [...firedTags]
    .map((tag) => ({ tag, text: learn?.insights?.[tag] }))
    .filter((s): s is { tag: string; text: string } => Boolean(s.text));

  return (
    <div className="gh-beat">
      <div className="gh-beat-eyebrow">the idea</div>
      <div className="gh-beat-concept">{concept}</div>
      {reveal?.body && <p className="gh-beat-body">{reveal.body}</p>}
      {reveal?.inTheWild && <p className="gh-beat-wild">{reveal.inTheWild}</p>}
      {stumbles.length > 0 && (
        <div className="gh-beat-stumble">
          <h4>where you stumbled</h4>
          {stumbles.map((s) => (
            <p key={s.tag}>{s.text}</p>
          ))}
        </div>
      )}
      <div className="gh-beat-actions">
        <button className="rd-run" onClick={onContinue}>
          Continue →
        </button>
      </div>
    </div>
  );
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
