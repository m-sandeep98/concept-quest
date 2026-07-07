import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GameProps, ThemeNode } from "../../types";
import { evaluate, type StateTraversalLevel, type StateTraversalResult, type Walk } from "./engine";
import { StateTraversalScene } from "./scene";
import "./styles.css";

function hexToNum(hex: string, fallback = 0x35e0ff): number {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  return m ? parseInt(m[1], 16) : fallback;
}

export default function StateTraversal({
  level,
  theme,
  themeNode,
  onSignal,
  onComplete,
}: GameProps<StateTraversalLevel>) {
  // The player drives a token one hop per input symbol. `walk` is the ordered list of
  // states they've stepped it onto; engine.ts grades the finished walk (never the shell).
  const [walk, setWalk] = useState<Walk>([]);
  const [phase, setPhase] = useState<"play" | "done">("play");
  const [result, setResult] = useState<StateTraversalResult | null>(null);
  const [ready, setReady] = useState(false);
  const [hopping, setHopping] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<StateTraversalScene | null>(null);
  const signalledRef = useRef(false);
  const busyRef = useRef(false); // guards against re-clicks mid-glide (state is async)

  const cursor = walk.length; // symbols consumed so far == the next one being read
  const current = walk.length ? walk[walk.length - 1] : level.start;
  const atEnd = walk.length >= level.input.length;

  const stateWord = theme.vocab.state ?? "State";
  const readWord = theme.vocab.read ?? "Reading";
  const stepWord = theme.vocab.step ?? "Step";

  // Mount the Pixi scene once for this node (StrictMode is off — see main.tsx).
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const scene = new StateTraversalScene({
      accent: hexToNum(theme.visual.accent),
      actorIcon: theme.visual.actorIcon,
      startLabel: theme.vocab.start ?? "start",
      reducedMotion: reduced,
    });
    sceneRef.current = scene;
    let alive = true;
    scene.init(hostRef.current!).then(() => {
      if (!alive) return;
      scene.draw(level, { current: level.start, cursor: 0 });
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

  // Walk the token to `to` for the symbol at the cursor, then advance the tape. No engine
  // call here — the machine is only graded on Run (HARD RULE #4: engine is the sole judge).
  function hop(to: string): void {
    if (!ready || phase !== "play" || busyRef.current || atEnd) return;
    busyRef.current = true;
    setHopping(true);
    const nextWalk = [...walk, to];
    setWalk(nextWalk);
    sceneRef.current?.playHop(to, () => {
      sceneRef.current?.draw(level, { current: to, cursor: nextWalk.length });
      busyRef.current = false;
      setHopping(false);
    });
  }

  function undo(): void {
    if (!ready || phase !== "play" || busyRef.current || walk.length === 0) return;
    const nextWalk = walk.slice(0, -1);
    const back = nextWalk.length ? nextWalk[nextWalk.length - 1] : level.start;
    setWalk(nextWalk);
    sceneRef.current?.draw(level, { current: back, cursor: nextWalk.length });
  }

  function run(): void {
    if (!ready || phase !== "play" || busyRef.current || (walk.length === 0 && !atEnd)) return;
    const r = evaluate(level, walk);
    setResult(r);
    signalledRef.current = false;
    setPhase("done");
    // Replay the verdict: halt the token on the machine's real end state, light the valid
    // path, and (if any) mark the illegal hop the player tried to take.
    const validSteps = r.trace.filter((t) => t.valid).length;
    sceneRef.current?.draw(level, {
      current: r.endState,
      cursor: validSteps,
      trace: r.trace,
      outcome: r.outcome,
    });
  }

  function retry(): void {
    setResult(null);
    setPhase("play");
    setWalk([]);
    sceneRef.current?.draw(level, { current: level.start, cursor: 0 });
  }

  // Emit gap signals from a failed run (a PLAY state), exactly once.
  useEffect(() => {
    if (phase === "done" && result && result.outcome !== "success" && !signalledRef.current) {
      result.signals.forEach((s) => onSignal(s));
      signalledRef.current = true;
    }
  }, [phase, result, onSignal]);

  const wrapStyle = { "--accent": theme.visual.accent } as CSSProperties;

  return (
    <div className="st" style={wrapStyle}>
      <div className="st-hud">
        <span className="st-cur">
          {stateWord} <b>{current}</b>
        </span>
        <span className="st-read">
          {phase === "play" && !atEnd ? (
            <>
              {readWord} <b>{level.input[cursor]}</b>
            </>
          ) : (
            <>
              {stepWord} {Math.min(walk.length, level.input.length)}/{level.input.length}
            </>
          )}
        </span>
      </div>

      <div className="st-stage-wrap">
        <div className="st-stage" ref={hostRef} />
        {!ready && <div className="st-boot">initializing renderer…</div>}
      </div>

      {phase === "play" && (
        <div className="st-tray">
          {level.states.map((s) => (
            <button
              key={s}
              className={`st-node-btn ${s === current ? "cur" : ""}`}
              onClick={() => hop(s)}
              disabled={hopping || atEnd}
              title={`${theme.vocab.move ?? "walk to"} ${s}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="rd-controls">
        {phase === "play" && (
          <>
            <button
              className="rd-run"
              onClick={run}
              disabled={!ready || hopping || (walk.length === 0 && !atEnd)}
            >
              ▶ {theme.vocab.runWord ?? "Run the machine"}
            </button>
            {walk.length > 0 && (
              <button className="rd-run ghost" onClick={undo} disabled={hopping}>
                ↩ {theme.vocab.undoWord ?? "Undo"}
              </button>
            )}
            <span className="st-hint">
              {atEnd
                ? theme.vocab.hintDone ??
                  "Whole input read — run the machine to see if it halts on an accepting state."
                : theme.vocab.hint ??
                  `Reading "${level.input[cursor]}" — click the state its arrow points to.`}
            </span>
          </>
        )}
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

function failMessage(result: StateTraversalResult, themeNode: ThemeNode): string {
  const tag = result.signals[0];
  if (tag && themeNode.failText?.[tag]) return themeNode.failText[tag];
  switch (result.outcome) {
    case "stuck":
      return "The machine jammed — no arrow leaves that state on the symbol you were reading. A dead end means this input can't be accepted along that path.";
    case "wrong-transition":
      return "An arrow exists for that symbol, but it leads to a different state. Follow the arrow labeled with the symbol you're reading — don't guess the target.";
    case "rejected":
      return "You fed the whole input in, but the token halted on a non-accepting state. The machine rejects this string.";
    case "incomplete":
      return "You stopped before the whole input was read. Feed every symbol to the machine before running it.";
    default:
      return "That run didn't accept. Trace the arrows symbol by symbol and try again.";
  }
}
