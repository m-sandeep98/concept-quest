import { useEffect, useState } from "react";
import type { Graph, GraphNode, Theme } from "./types";
import { loadDomain } from "./shell/contentLoader";
import { getModule } from "./archetypes/registry";
import QuestMap from "./shell/Map";
import GameHost from "./shell/GameHost";
import TicketModal from "./shell/TicketModal";
import Kanban from "./shell/Kanban";
import { postTicket } from "./shell/tickets";
import {
  addManualTicket,
  applyComplete,
  applySignal,
  freshProgress,
  loadProgress,
  saveProgress,
  type Progress,
  type Ticket,
} from "./shell/progress";

// Each domain is one archetype's content. Adding a game type surfaces here as one entry.
const DOMAINS = [
  { shape: "recursive-descent", label: "🌀 Recursion" },
  { shape: "sequence", label: "📋 Sequence / Process" },
];

export default function App() {
  const [shapeId, setShapeId] = useState(DOMAINS[0].shape);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themeId, setThemeId] = useState("");
  const [progress, setProgress] = useState<Progress>(freshProgress());
  const [view, setView] = useState<{ mode: "map" } | { mode: "play"; nodeId: string }>({ mode: "map" });
  const [modalTicket, setModalTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setError(null);
    setView({ mode: "map" });
    loadDomain(shapeId)
      .then(({ graph, themes }) => {
        if (cancelled) return;
        setGraph(graph);
        setThemes(themes);
        const first = themes[0]?.id ?? "";
        setThemeId(first);
        setProgress(loadProgress(shapeId, first));
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [shapeId]);

  useEffect(() => {
    if (graph && themeId && themes.some((t) => t.id === themeId)) {
      saveProgress(shapeId, themeId, progress);
    }
  }, [shapeId, themeId, themes, graph, progress]);

  if (error) return <div className="app-msg error">Failed to load content: {error}</div>;
  if (!graph || !themeId) return <div className="app-msg">Loading…</div>;

  const theme = themes.find((t) => t.id === themeId)!;
  const nodeById = (id: string) => graph.nodes.find((n) => n.id === id)!;

  function switchTheme(id: string) {
    setThemeId(id);
    setProgress(loadProgress(shapeId, id));
    setView({ mode: "map" });
  }

  function handleComplete(nodeId: string) {
    const { progress: next, newTicket } = applyComplete(progress, nodeById(nodeId));
    setProgress(next);
    if (newTicket) {
      setModalTicket(newTicket);
      void postTicket(shapeId, newTicket); // hand the gap to the offline authoring server
    }
    setView({ mode: "map" });
  }

  function handleEscapeHatch(node: GraphNode) {
    const { progress: next, ticket } = addManualTicket(progress, node);
    setProgress(next);
    setModalTicket(ticket);
    void postTicket(shapeId, ticket);
    setView({ mode: "map" });
  }

  // A ticket was authored into new content: re-read the graph and surface the new node.
  async function onAuthored(nodeId: string) {
    try {
      const { graph: g, themes: th } = await loadDomain(shapeId);
      setGraph(g);
      setThemes(th);
      setProgress((p) => (p.surfaced.includes(nodeId) ? p : { ...p, surfaced: [...p.surfaced, nodeId] }));
    } catch {
      /* ignore */
    }
  }

  function resetProgress() {
    const fresh = freshProgress();
    setProgress(fresh);
    saveProgress(shapeId, themeId, fresh);
    setView({ mode: "map" });
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Concept Quest</h1>
        <p className="app-sub">
          archetype <code>{graph.shape}</code> · now teaching <strong>{theme.subject}</strong>
        </p>
        <div className="domain-switch">
          {DOMAINS.map((d) => (
            <button
              key={d.shape}
              className={`domain-btn ${d.shape === shapeId ? "on" : ""}`}
              onClick={() => setShapeId(d.shape)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </header>

      {view.mode === "map" ? (
        <>
          <QuestMap
            graph={graph}
            theme={theme}
            themes={themes}
            progress={progress}
            onOpen={(id) => setView({ mode: "play", nodeId: id })}
            onSwitchTheme={switchTheme}
            onReset={resetProgress}
          />
          <Kanban shape={shapeId} onAuthored={onAuthored} />
        </>
      ) : (
        <GameHost
          key={`${shapeId}:${themeId}:${view.nodeId}`}
          node={nodeById(view.nodeId)}
          theme={theme}
          gameModule={getModule(nodeById(view.nodeId).shape)}
          onSignal={(tag) => setProgress((p) => applySignal(p, view.nodeId, tag))}
          onComplete={() => handleComplete(view.nodeId)}
          onExit={() => setView({ mode: "map" })}
          onEscapeHatch={() => handleEscapeHatch(nodeById(view.nodeId))}
        />
      )}

      {modalTicket && <TicketModal ticket={modalTicket} shape={shapeId} onClose={() => setModalTicket(null)} />}
    </div>
  );
}
