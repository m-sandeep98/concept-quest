import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GameProps, ThemeNode } from "../../types";
import { allAssigned, evaluate, type Assignment, type BatchPackingLevel, type BatchRunResult } from "./engine";
import { BatchScene } from "./scene";
import "./batchPacking.css";

// Hex mirror of scene.BATCH_HUES so a request chip matches its batch column color.
const BATCH_COLORS = ["#35e0ff", "#8b7bff", "#3ad0b0", "#ffb454", "#ff6b9d", "#9fe870", "#5aa9ff", "#f0c674"];

function hexToNum(hex: string, fallback = 0x35e0ff): number {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  return m ? parseInt(m[1], 16) : fallback;
}

export default function BatchPacking({
  level,
  theme,
  themeNode,
  onSignal,
  onComplete,
}: GameProps<BatchPackingLevel>) {
  // Max batches the player can spread across = one per request (the serial worst case).
  const K = Math.max(1, level.requests.length);
  const batchWord = theme.vocab.batch ?? "batch";

  // requestId -> batch index; starts unassigned (-1). Clicking a chip places/advances it.
  const [assignment, setAssignment] = useState<Assignment>({});
  const [phase, setPhase] = useState<"play" | "running" | "done">("play");
  const [result, setResult] = useState<BatchRunResult | null>(null);
  const [ready, setReady] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BatchScene | null>(null);
  const signalledRef = useRef(false);

  const placed = allAssigned(level, assignment);
  const batchesUsed = useMemo(
    () => new Set(level.requests.map((r) => assignment[r.id]).filter((b) => typeof b === "number" && b >= 0)).size,
    [level.requests, assignment],
  );
  const overBudget = batchesUsed > level.budget;

  function cycle(id: string): void {
    if (phase !== "play") return;
    setAssignment((a) => {
      const cur = a[id];
      const next = typeof cur !== "number" || cur < 0 ? 0 : (cur + 1) % K;
      return { ...a, [id]: next };
    });
  }

  // Mount the Pixi scene once for this node (StrictMode is off — see main.tsx).
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const scene = new BatchScene({
      accent: hexToNum(theme.visual.accent),
      actorIcon: theme.visual.actorIcon,
      unitLabel: theme.vocab.unit ?? "units",
      capacityLabel: theme.vocab.capacityLabel ?? "capacity",
      batchLabel: batchWord,
      reducedMotion: reduced,
    });
    sceneRef.current = scene;
    let alive = true;
    scene.init(hostRef.current!).then(() => {
      if (!alive) return;
      scene.draw(level, {});
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

  // Keep the canvas in sync with the assignment while building.
  useEffect(() => {
    if (ready && phase !== "running") sceneRef.current?.draw(level, assignment);
  }, [ready, phase, level, assignment]);

  function runBatches(): void {
    if (!ready || !placed) return;
    const r = evaluate(level, assignment);
    setResult(r);
    signalledRef.current = false;
    setPhase("running");
    sceneRef.current?.playRun(() => setPhase("done"));
  }

  function retry(): void {
    setResult(null);
    setPhase("play");
    setAssignment({});
    sceneRef.current?.draw(level, {});
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
    <div className="bp" style={wrapStyle}>
      <div className="bp-hud">
        <span className="bp-res">
          {theme.vocab.resource ?? "Resource"} · {theme.vocab.capacityLabel ?? "cap"} <b>{level.capacity}</b>{" "}
          {theme.vocab.unit ?? "units"}
        </span>
        <span className={`bp-count ${overBudget ? "over" : ""}`}>
          {batchesUsed} / {level.budget} {batchWord}
        </span>
      </div>

      <div className="bp-stage-wrap">
        <div className="bp-stage" ref={hostRef} />
        {!ready && <div className="bp-boot">initializing renderer…</div>}
      </div>

      {phase === "play" && (
        <div className="bp-tray">
          {level.requests.map((r) => {
            const b = assignment[r.id];
            const on = typeof b === "number" && b >= 0;
            return (
              <button
                key={r.id}
                className="bp-chip"
                onClick={() => cycle(r.id)}
                title={`${theme.vocab.item ?? "item"} ${r.id} · move to next ${batchWord}`}
              >
                <span>{r.id}</span>
                <span className="bp-chip-size">·{r.size}</span>
                <span
                  className="bp-chip-batch"
                  style={{ background: on ? BATCH_COLORS[b % BATCH_COLORS.length] : "var(--line)" }}
                >
                  {on ? `${batchWord[0].toUpperCase()}${b + 1}` : "—"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="rd-controls">
        {phase === "play" && (
          <>
            <button className="rd-run" onClick={runBatches} disabled={!ready || !placed}>
              ▶ {theme.vocab.runWord ?? "Run batches"}
            </button>
            <span className="bp-hint">
              {placed
                ? theme.vocab.hint ?? "Pack each batch as full as capacity allows — fewer batches is better."
                : `Tap each ${theme.vocab.item ?? "item"} to place it in a ${batchWord}.`}
            </span>
          </>
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

function failMessage(result: BatchRunResult, themeNode: ThemeNode): string {
  const tag = result.signals[0];
  if (tag && themeNode.failText?.[tag]) return themeNode.failText[tag];
  if (result.outcome === "overcommit") return "A batch overflowed capacity — that's an out-of-memory. Spread those requests across more batches.";
  return "That works, but it took too many batches. Pack each batch fuller to raise throughput.";
}
