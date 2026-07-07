import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GameProps, ThemeNode } from "../../types";
import {
  budgetFor,
  dirFor,
  evaluate,
  feasibleAfter,
  type BinarySearchLevel,
  type RunResult,
} from "./engine";
import { SearchScene } from "./scene";
import "./binarySearch.css";

function hexToNum(hex: string, fallback = 0x35e0ff): number {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  return m ? parseInt(m[1], 16) : fallback;
}

export default function BinarySearch({
  level,
  theme,
  themeNode,
  onSignal,
  onComplete,
}: GameProps<BinarySearchLevel>) {
  const { values, targetIndex } = level;
  const budget = budgetFor(level);
  const targetValue = values[targetIndex];

  const [probes, setProbes] = useState<number[]>([]);
  const [phase, setPhase] = useState<"play" | "done">("play");
  const [result, setResult] = useState<RunResult | null>(null);
  const [ready, setReady] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SearchScene | null>(null);
  const probesRef = useRef<number[]>([]);
  const signalledRef = useRef(false);

  // A probe reported from the canvas: compute feedback + the narrowed range with the
  // pure engine, animate it, and (when the target is found) grade the whole run.
  const handleProbe = useCallback(
    (index: number) => {
      const next = [...probesRef.current, index];
      probesRef.current = next;
      setProbes(next);
      const dir = dirFor(values, targetIndex, index);
      const { lo, hi } = feasibleAfter(values, targetIndex, next);
      sceneRef.current?.reveal(index, dir, lo, hi, () => {
        if (dir !== "found") return;
        const r = evaluate(level, probesRef.current);
        setResult(r);
        setPhase("done");
        if (r.outcome !== "success" && !signalledRef.current) {
          r.signals.forEach((s) => onSignal(s));
          signalledRef.current = true;
        }
      });
    },
    [level, values, targetIndex, onSignal],
  );

  // Mount the Pixi scene once for this node (StrictMode is off — see main.tsx).
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const scene = new SearchScene({
      actorIcon: theme.visual.actorIcon,
      coreIcon: theme.visual.coreIcon ?? "💎",
      accent: hexToNum(theme.visual.accent),
      reducedMotion: reduced,
      higherLabel: theme.vocab.higher ?? "higher",
      lowerLabel: theme.vocab.lower ?? "lower",
    });
    sceneRef.current = scene;
    let alive = true;
    scene.init(hostRef.current!).then(() => {
      if (!alive) return;
      scene.setup(values, targetIndex, handleProbe);
      setReady(true);
    });
    return () => {
      alive = false;
      sceneRef.current = null;
      scene.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function retry() {
    probesRef.current = [];
    signalledRef.current = false;
    setProbes([]);
    setResult(null);
    setPhase("play");
    sceneRef.current?.reset(values, targetIndex, handleProbe);
  }

  const wrapStyle = { "--accent": theme.visual.accent } as CSSProperties;
  const overBudget = probes.length > budget;

  return (
    <div className="bs" style={wrapStyle}>
      <div className="bs-hud">
        <span className="bs-target">
          {theme.vocab.target ?? "TARGET"} · <b>{targetValue}</b>
        </span>
        <span className={`bs-probes ${overBudget ? "over" : ""}`}>
          {probes.length} / {budget} {theme.vocab.probeWord ?? "probes"}
        </span>
      </div>

      <div className="bs-stage-wrap">
        <div className="bs-stage" ref={hostRef} />
        {!ready && <div className="bs-boot">initializing renderer…</div>}
      </div>

      <div className="rd-controls">
        {phase === "play" && (
          <>
            <span className="bs-hint">
              {ready ? theme.vocab.hint ?? "Open a vault to narrow it down." : "…"}
            </span>
            {probes.length > 0 && (
              <button className="rd-run ghost" onClick={retry}>
                ↺ Start over
              </button>
            )}
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

function failMessage(result: RunResult, themeNode: ThemeNode): string {
  const tag = result.signals[0];
  if (tag && themeNode.failText?.[tag]) return themeNode.failText[tag];
  if (result.outcome === "slow") return "Found it — but that took too many probes. Cut the range in half each time.";
  return "You opened a vault the clues had already ruled out. Trust the higher/lower feedback.";
}
