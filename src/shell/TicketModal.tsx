import type { Ticket } from "./progress";

export default function TicketModal({
  ticket,
  shape,
  onClose,
}: {
  ticket: Ticket;
  shape: string;
  onClose: () => void;
}) {
  const spec = ticket.kind === "manual" ? "learner-reported" : ticket.spec;
  const reason =
    ticket.kind === "manual"
      ? "learner pressed “I don't get this”"
      : "deterministic gap threshold crossed during play";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-tag">🎫 Claude Code · self-heal ticket</div>
        <h3>New sidequest requested</h3>
        <pre className="ticket-spec">
{`shape:      ${shape}
generate:   ${spec}
gap:        ${ticket.gap}
from node:  ${ticket.source}
reason:     ${reason}`}
        </pre>
        <p className="modal-note">
          In production this queues as a kanban ticket. Claude Code authors a new node
          (structure + theme skins), drops the file into <code>content/{shape}/</code>, and it
          appears in the graph. <strong>No LLM runs in the play loop</strong> — the engine just
          reads the new data.
        </p>
        <button className="rd-run" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
