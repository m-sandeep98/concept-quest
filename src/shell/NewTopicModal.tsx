import { useState } from "react";
import { authorTopic } from "./tickets";

export default function NewTopicModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const [concept, setConcept] = useState("");
  const [phase, setPhase] = useState<"idle" | "authoring" | "error">("idle");
  const [error, setError] = useState("");

  async function go() {
    const c = concept.trim();
    if (!c || phase === "authoring") return;
    setPhase("authoring");
    setError("");
    try {
      const res = await authorTopic(c);
      onCreated(res.slug);
    } catch (e) {
      setPhase("error");
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="modal-backdrop" onClick={phase === "authoring" ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-tag">🎓 New topic · authored by Claude Code</div>
        <h3>Gamify any concept</h3>
        <p className="modal-note">
          Type a concept. Claude Code picks the archetype whose <em>shape</em> fits, authors a full playable
          game (intro → levels → boss), and validates it before it appears.
        </p>
        <input
          className="topic-input"
          placeholder="e.g. how a bill becomes law · photosynthesis · the water cycle"
          value={concept}
          disabled={phase === "authoring"}
          onChange={(e) => setConcept(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          autoFocus
        />
        {phase === "error" && <p className="topic-error">✕ {error}</p>}
        <div className="topic-actions">
          {phase === "authoring" ? (
            <span className="topic-authoring">🛠️ Claude Code is authoring a full game… (~1 min · claude -p)</span>
          ) : (
            <>
              <button className="rd-run ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="rd-run" onClick={go} disabled={!concept.trim()}>
                Author game
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
