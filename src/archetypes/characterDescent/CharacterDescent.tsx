import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GameProps, ThemeNode } from "../../types";
import { run, type BlockId, type CharacterDescentLevel, type RunResult } from "./engine";
import { DescentScene } from "./scene";
import "./characterDescent.css";

// Which rule slot a block belongs to: 1 = base case, 2 = recursive step.
const SLOT: Record<BlockId, 1 | 2> = { stop: 1, descend: 2, descendSame: 2 };

function hexToNum(hex: string, fallback = 0x35e0ff): number {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  return m ? parseInt(m[1], 16) : fallback;
}

export default function CharacterDescent({
  level,
  theme,
  themeNode,
  onSignal,
  onComplete,
}: GameProps<CharacterDescentLevel>) {
  const [rule, setRule] = useState<BlockId[]>(() => [...level.preplaced]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [phase, setPhase] = useState<"build" | "running" | "done">("build");
  const [signalled, setSignalled] = useState(false);
  const [ready, setReady] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<DescentScene | null>(null);

  const isLocked = (b: BlockId) => level.preplaced.includes(b);

  function toggle(b: BlockId) {
    if (phase !== "build") return;
    setRule((r) => {
      if (r.includes(b)) return isLocked(b) ? r : r.filter((x) => x !== b);
      // fill this block's slot, replacing any other (unlocked) block in the same slot
      const cleared = r.filter((x) => SLOT[x] !== SLOT[b] || isLocked(x));
      return [...cleared, b];
    });
  }

  // Mount the Pixi scene once for this node. StrictMode is off (see main.tsx), so this
  // runs a single time; `alive` still guards the async init against a fast unmount.
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const scene = new DescentScene({
      actorIcon: theme.visual.actorIcon,
      coreIcon: theme.visual.coreIcon ?? "◎",
      accent: hexToNum(theme.visual.accent),
      depthLabel: theme.vocab.depthLabel ?? "n",
      reducedMotion: reduced,
    });
    sceneRef.current = scene;
    let alive = true;
    scene.init(hostRef.current!).then(() => {
      if (!alive) return;
      scene.idle(level.startDepth);
      setReady(true);
    });
    return () => {
      alive = false;
      sceneRef.current = null;
      scene.destroy();
    };
    // Mount-once: the node (and its level) is fixed for this component instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cast() {
    if (!ready) return;
    const r = run(rule, level.startDepth);
    setResult(r);
    setSignalled(false);
    setPhase("running");
    sceneRef.current?.play(r.trace, () => setPhase("done"));
  }

  function retry() {
    setResult(null);
    setPhase("build");
    sceneRef.current?.idle(level.startDepth);
  }

  // Emit gap signals from a failed run (a PLAY state), exactly once.
  useEffect(() => {
    if (phase === "done" && result && result.outcome !== "success" && !signalled) {
      result.signals.forEach((s) => onSignal(s));
      setSignalled(true);
    }
  }, [phase, result, signalled, onSignal]);

  const stopBlock = rule.find((b) => SLOT[b] === 1) ?? null;
  const stepBlock = rule.find((b) => SLOT[b] === 2) ?? null;
  const wrapStyle = { "--accent": theme.visual.accent } as CSSProperties;

  return (
    <div className="cd" style={wrapStyle}>
      <div className="cd-stage-wrap">
        <div className="cd-stage" ref={hostRef} />
        {!ready && <div className="cd-boot">initializing renderer…</div>}
      </div>

      <div className="rd-rule">
        <div className={`rd-slot ${stopBlock ? "filled" : ""}`}>
          <span className="rd-slot-tag">① base case</span>
          <span className="rd-slot-body">{stopBlock ? theme.vocab[stopBlock] : "if … → stop & return"}</span>
        </div>
        <div className={`rd-slot ${stepBlock ? "filled" : ""}`}>
          <span className="rd-slot-tag">② recursive step</span>
          <span className="rd-slot-body">{stepBlock ? theme.vocab[stepBlock] : "… go one deeper"}</span>
        </div>
      </div>

      {phase === "build" && level.palette.length > 0 && (
        <div className="rd-palette">
          {level.palette.map((b) => (
            <button key={b} className={`rd-block ${rule.includes(b) ? "on" : ""}`} onClick={() => toggle(b)}>
              {theme.vocab[b]}
            </button>
          ))}
        </div>
      )}

      <div className="rd-controls">
        {phase === "build" && (
          <button className="rd-run" onClick={cast} disabled={!ready}>
            ▶ {theme.vocab.run ?? "Run"}
          </button>
        )}
        {phase === "running" && <span className="rd-status">running…</span>}
        {phase === "done" &&
          result &&
          (result.outcome === "success" ? (
            <div className="rd-outcome win">
              <p>{themeNode.winText}</p>
              <button className="rd-run" onClick={() => onComplete({ won: true })}>
                ✓ Continue
              </button>
            </div>
          ) : (
            <div className="rd-outcome fail">
              <p>{failMessage(result, themeNode)}</p>
              <button className="rd-run ghost" onClick={retry}>
                ↻ Try again
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

function failMessage(result: RunResult, themeNode: ThemeNode): string {
  const tag = result.signals[0];
  if (tag && themeNode.failText?.[tag]) return themeNode.failText[tag];
  if (result.outcome === "stuck") return "It ended without reaching the core — add a step that actually goes deeper.";
  return "That didn't work — adjust the rule and try again.";
}
