import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { GameProps, Theme, ThemeNode } from "../../types";
import { run, stackAt, type BlockId, type RecursiveDescentLevel, type RunResult } from "./engine";

// Which rule slot a block belongs to: 1 = base case, 2 = recursive step.
const SLOT: Record<BlockId, 1 | 2> = { stop: 1, descend: 2, descendSame: 2 };

export default function RecursiveDescent({
  level,
  theme,
  themeNode,
  onSignal,
  onComplete,
}: GameProps<RecursiveDescentLevel>) {
  const [rule, setRule] = useState<BlockId[]>(() => [...level.preplaced]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<"build" | "running" | "done">("build");
  const [signalled, setSignalled] = useState(false);

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

  function cast() {
    setResult(run(rule, level.startDepth));
    setStep(0);
    setSignalled(false);
    setPhase("running");
  }

  function retry() {
    setPhase("build");
    setResult(null);
    setStep(0);
  }

  // Step the animation forward, then settle into "done".
  useEffect(() => {
    if (phase !== "running" || !result) return;
    if (step < result.trace.length - 1) {
      const id = setTimeout(() => setStep((s) => s + 1), 460);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setPhase("done"), 750);
    return () => clearTimeout(id);
  }, [phase, step, result]);

  // Emit gap signals from a failed run (a PLAY state), exactly once.
  useEffect(() => {
    if (phase === "done" && result && result.outcome !== "success" && !signalled) {
      result.signals.forEach((s) => onSignal(s));
      setSignalled(true);
    }
  }, [phase, result, signalled, onSignal]);

  const shownStack = result ? stackAt(result.trace, step) : [];
  const sliced = result ? result.trace.slice(0, step + 1) : [];
  const sawBase = sliced.some((e) => e.type === "base");
  const sawOverflow = sliced.some((e) => e.type === "overflow");

  const stopBlock = rule.find((b) => SLOT[b] === 1) ?? null;
  const stepBlock = rule.find((b) => SLOT[b] === 2) ?? null;

  const wrapStyle = { "--accent": theme.visual.accent } as CSSProperties;

  return (
    <div className="rd" style={wrapStyle}>
      <div className="rd-stage">
        <div className="rd-well-panel">
          <div className={`rd-well ${sawOverflow ? "overflow" : ""}`}>
            {phase === "build" ? (
              <div className="rd-well-idle">
                <div className={`well-shell ${theme.visual.containerShape}`}>
                  <span className="well-depth">
                    {theme.vocab.depthLabel} = {level.startDepth}
                  </span>
                  <div className="well-core">{theme.visual.actorIcon}</div>
                </div>
              </div>
            ) : (
              <Nest stack={shownStack} idx={0} sawBase={sawBase} sawOverflow={sawOverflow} theme={theme} />
            )}
          </div>
        </div>

        <div className="rd-stack-panel">
          <div className="rd-stack-title">call stack</div>
          <div className="rd-stack">
            {phase !== "build" && shownStack.length === 0 && !sawOverflow && (
              <div className="rd-frame empty">— empty —</div>
            )}
            {[...shownStack].reverse().map((d, i) => (
              <div key={i} className="rd-frame">
                {theme.vocab.unit} · {theme.vocab.depthLabel}={d}
              </div>
            ))}
            {sawOverflow && <div className="rd-frame of">STACK OVERFLOW ✕</div>}
          </div>
        </div>
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
          <button className="rd-run" onClick={cast}>
            ▶ {theme.vocab.run}
          </button>
        )}
        {phase === "running" && <span className="rd-status">running…</span>}
        {phase === "done" && result && (
          result.outcome === "success" ? (
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
          )
        )}
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

function Nest({
  stack,
  idx,
  sawBase,
  sawOverflow,
  theme,
}: {
  stack: number[];
  idx: number;
  sawBase: boolean;
  sawOverflow: boolean;
  theme: Theme;
}) {
  if (idx >= stack.length) {
    const icon = sawOverflow ? "🕳️" : sawBase ? theme.visual.coreIcon : theme.visual.actorIcon;
    return <div className="well-core">{icon}</div>;
  }
  return (
    <div className={`well-shell ${theme.visual.containerShape}`}>
      <span className="well-depth">
        {theme.vocab.depthLabel} = {stack[idx]}
      </span>
      <Nest stack={stack} idx={idx + 1} sawBase={sawBase} sawOverflow={sawOverflow} theme={theme} />
    </div>
  );
}
