import { useEffect, useState } from "react";
import type { Graph, GraphNode, Theme } from "./types";
import { loadDomain } from "./shell/contentLoader";
import { getModule } from "./archetypes/registry";
import QuestMap from "./shell/Map";
import GameHost from "./shell/GameHost";
import TicketModal from "./shell/TicketModal";
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

const SHAPE = "recursive-descent";

export default function App() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themeId, setThemeId] = useState("");
  const [progress, setProgress] = useState<Progress>(freshProgress());
  const [view, setView] = useState<{ mode: "map" } | { mode: "play"; nodeId: string }>({ mode: "map" });
  const [modalTicket, setModalTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDomain(SHAPE)
      .then(({ graph, themes }) => {
        setGraph(graph);
        setThemes(themes);
        const first = themes[0]?.id ?? "";
        setThemeId(first);
        setProgress(loadProgress(SHAPE, first));
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (themeId) saveProgress(SHAPE, themeId, progress);
  }, [themeId, progress]);

  if (error) return <div className="app-msg error">Failed to load content: {error}</div>;
  if (!graph || !themeId) return <div className="app-msg">Loading…</div>;

  const theme = themes.find((t) => t.id === themeId)!;
  const nodeById = (id: string) => graph.nodes.find((n) => n.id === id)!;

  function switchTheme(id: string) {
    setThemeId(id);
    setProgress(loadProgress(SHAPE, id));
    setView({ mode: "map" });
  }

  function handleComplete(nodeId: string) {
    const { progress: next, newTicket } = applyComplete(progress, nodeById(nodeId));
    setProgress(next);
    if (newTicket) setModalTicket(newTicket);
    setView({ mode: "map" });
  }

  function handleEscapeHatch(node: GraphNode) {
    const { progress: next, ticket } = addManualTicket(progress, node);
    setProgress(next);
    setModalTicket(ticket);
    setView({ mode: "map" });
  }

  function resetProgress() {
    const fresh = freshProgress();
    setProgress(fresh);
    saveProgress(SHAPE, themeId, fresh);
    setView({ mode: "map" });
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Concept Quest</h1>
        <p className="app-sub">
          archetype <code>{graph.shape}</code> · now teaching <strong>{theme.subject}</strong>
        </p>
      </header>

      {view.mode === "map" ? (
        <QuestMap
          graph={graph}
          theme={theme}
          themes={themes}
          progress={progress}
          onOpen={(id) => setView({ mode: "play", nodeId: id })}
          onSwitchTheme={switchTheme}
          onReset={resetProgress}
          onShowTicket={setModalTicket}
        />
      ) : (
        <GameHost
          key={`${themeId}:${view.nodeId}`}
          node={nodeById(view.nodeId)}
          theme={theme}
          gameModule={getModule(nodeById(view.nodeId).shape)}
          onSignal={(tag) => setProgress((p) => applySignal(p, view.nodeId, tag))}
          onComplete={() => handleComplete(view.nodeId)}
          onExit={() => setView({ mode: "map" })}
          onEscapeHatch={() => handleEscapeHatch(nodeById(view.nodeId))}
        />
      )}

      {modalTicket && <TicketModal ticket={modalTicket} shape={SHAPE} onClose={() => setModalTicket(null)} />}
    </div>
  );
}
