import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { GameProps, ThemeNode } from "../../types";
import { runSequence, type SequenceLevel, type SeqRun } from "./engine";
import "./sequence.css";

type StepSkin = { label: string; icon?: string };

export default function Sequence({ level, theme, themeNode, onSignal, onComplete }: GameProps<SequenceLevel>) {
  const canonical = level.steps.map((s) => s.id);
  const [placed, setPlaced] = useState<string[]>([]);
  const [result, setResult] = useState<SeqRun | null>(null);
  const [cursor, setCursor] = useState(0);
  const [phase, setPhase] = useState<"build" | "running" | "done">("build");
  const [signalled, setSignalled] = useState(false);

  const skins = (themeNode.extra?.steps ?? {}) as Record<string, StepSkin>;
  const label = (id: string) => skins[id]?.label ?? id;
  const icon = (id: string) => skins[id]?.icon ?? "•";
  const tray = canonical.filter((id) => !placed.includes(id));

  function place(id: string) {
    if (phase === "build") setPlaced((p) => [...p, id]);
  }
  function unplace(id: string) {
    if (phase === "build") setPlaced((p) => p.filter((x) => x !== id));
  }
  function runIt() {
    setResult(runSequence(placed, level.steps));
    setCursor(0);
    setSignalled(false);
    setPhase("running");
  }
  function retry() {
    setPhase("build");
    setResult(null);
    setCursor(0);
  }

  useEffect(() => {
    if (phase !== "running" || !result) return;
    if (cursor < result.events.length - 1) {
      const id = setTimeout(() => setCursor((c) => c + 1), 520);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setPhase("done"), 780);
    return () => clearTimeout(id);
  }, [phase, cursor, result]);

  useEffect(() => {
    if (phase === "done" && result && result.outcome !== "success" && !signalled) {
      result.signals.forEach((s) => onSignal(s));
      setSignalled(true);
    }
  }, [phase, result, signalled, onSignal]);

  const shown = result ? result.events.slice(0, cursor + 1) : [];
  const okCount = shown.filter((e) => e.type === "ok").length;
  const breakEv = shown.find((e) => e.type === "break") ?? null;
  const wrapStyle = { "--accent": theme.visual.accent } as CSSProperties;
  const total = canonical.length;

  return (
    <div className="seq" style={wrapStyle}>
      <div className="seq-line">
        {placed.length === 0 && <div className="seq-empty">Click steps below to place them here, in order →</div>}
        {placed.map((id, i) => {
          let state = "placed";
          if (phase !== "build") {
            if (breakEv && breakEv.index === i) state = "broke";
            else if (i < okCount) state = "done";
            else state = "pending";
          }
          const isCursor = phase === "running" && i === cursor;
          return (
            <div key={id} className={`seq-card ${state} ${isCursor ? "cursor" : ""}`} onClick={() => unplace(id)}>
              {isCursor && <span className="seq-actor">{theme.visual.actorIcon}</span>}
              <span className="seq-icon">{icon(id)}</span>
              <span className="seq-label">{label(id)}</span>
              {state === "broke" && breakEv && (
                <span className="seq-x">needs {breakEv.missing.map(label).join(" + ")} first</span>
              )}
            </div>
          );
        })}
      </div>

      {phase === "build" && tray.length > 0 && (
        <div className="seq-tray">
          <span className="seq-tray-label">steps (scrambled):</span>
          {tray.map((id) => (
            <button key={id} className="seq-card tray" onClick={() => place(id)}>
              <span className="seq-icon">{icon(id)}</span>
              <span className="seq-label">{label(id)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="seq-controls">
        {phase === "build" && (
          <button className="rd-run" disabled={placed.length !== total} onClick={runIt}>
            ▶ {theme.vocab.run}
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
              <p>{failMessage(result, themeNode, label)}</p>
              <button className="rd-run ghost" onClick={retry}>
                ↻ Try again
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

function failMessage(result: SeqRun, themeNode: ThemeNode, label: (id: string) => string): string {
  const tag = result.signals[0];
  if (tag && themeNode.failText?.[tag]) return themeNode.failText[tag];
  const b = result.events.find((e) => e.type === "break");
  if (b && b.type === "break") return `That step can't run yet — it needs ${b.missing.map(label).join(" + ")} first.`;
  return "Something's out of order — rearrange and try again.";
}
