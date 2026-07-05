import { useState } from "react";

export default function NewTopicModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (concept: string) => void;
}) {
  const [concept, setConcept] = useState("");
  function go() {
    const c = concept.trim();
    if (c) onSubmit(c);
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-tag">🎓 New topic · authored by Claude Code</div>
        <h3>Gamify any concept</h3>
        <p className="modal-note">
          Type a concept. Claude Code picks the archetype whose <em>shape</em> fits and authors a full playable game
          (intro → levels → boss) — watch it work live in the Claude Terminal, and it appears when it's done.
        </p>
        <input
          className="topic-input"
          placeholder="e.g. the water cycle · photosynthesis · how coffee is made"
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          autoFocus
        />
        <div className="topic-actions">
          <button className="rd-run ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="rd-run" onClick={go} disabled={!concept.trim()}>
            Author game →
          </button>
        </div>
      </div>
    </div>
  );
}
