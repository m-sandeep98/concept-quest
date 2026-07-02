import { useEffect, useState } from "react";
import type { Graph, GraphNode, Theme } from "./types";
import { loadDomain, loadDomainsIndex, type DomainEntry } from "./shell/contentLoader";
import { getModule } from "./archetypes/registry";
import QuestMap from "./shell/Map";
import GameHost from "./shell/GameHost";
import TicketModal from "./shell/TicketModal";
import Kanban from "./shell/Kanban";
import NewTopicModal from "./shell/NewTopicModal";
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

export default function App() {
  const [domains, setDomains] = useState<DomainEntry[]>([]);
  const [domainSlug, setDomainSlug] = useState("");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themeId, setThemeId] = useState("");
  const [progress, setProgress] = useState<Progress>(freshProgress());
  const [view, setView] = useState<{ mode: "map" } | { mode: "play"; nodeId: string }>({ mode: "map" });
  const [modalTicket, setModalTicket] = useState<Ticket | null>(null);
  const [newTopicOpen, setNewTopicOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which domains exist (new topics append here).
  useEffect(() => {
    loadDomainsIndex().then((d) => {
      setDomains(d);
      setDomainSlug((cur) => cur || d[0]?.slug || "");
    });
  }, []);

  // Load the selected domain's content graph + themes.
  useEffect(() => {
    if (!domainSlug) return;
    let cancelled = false;
    setGraph(null);
    setError(null);
    setView({ mode: "map" });
    loadDomain(domainSlug)
      .then(({ graph, themes }) => {
        if (cancelled) return;
        setGraph(graph);
        setThemes(themes);
        const first = themes[0]?.id ?? "";
        setThemeId(first);
        setProgress(loadProgress(domainSlug, first));
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [domainSlug]);

  useEffect(() => {
    if (graph && themeId && themes.some((t) => t.id === themeId)) {
      saveProgress(domainSlug, themeId, progress);
    }
  }, [domainSlug, themeId, themes, graph, progress]);

  if (error) return <div className="app-msg error">Failed to load content: {error}</div>;
  if (!graph || !themeId) return <div className="app-msg">Loading…</div>;

  const theme = themes.find((t) => t.id === themeId)!;
  const nodeById = (id: string) => graph.nodes.find((n) => n.id === id)!;

  function switchTheme(id: string) {
    setThemeId(id);
    setProgress(loadProgress(domainSlug, id));
    setView({ mode: "map" });
  }

  function handleComplete(nodeId: string) {
    const { progress: next, newTicket } = applyComplete(progress, nodeById(nodeId));
    setProgress(next);
    if (newTicket) {
      setModalTicket(newTicket);
      void postTicket(domainSlug, graph!.shape, newTicket);
    }
    setView({ mode: "map" });
  }

  function handleEscapeHatch(node: GraphNode) {
    const { progress: next, ticket } = addManualTicket(progress, node);
    setProgress(next);
    setModalTicket(ticket);
    void postTicket(domainSlug, graph!.shape, ticket);
    setView({ mode: "map" });
  }

  // A ticket authored new content into this domain: re-read the graph, surface the node.
  async function onAuthored(nodeId: string) {
    try {
      const { graph: g, themes: th } = await loadDomain(domainSlug);
      setGraph(g);
      setThemes(th);
      setProgress((p) => (p.surfaced.includes(nodeId) ? p : { ...p, surfaced: [...p.surfaced, nodeId] }));
    } catch {
      /* ignore */
    }
  }

  // A whole new topic was authored: refresh the domain index and switch to it.
  async function afterNewTopic(slug: string) {
    const d = await loadDomainsIndex();
    setDomains(d);
    setNewTopicOpen(false);
    setThemeId("");
    setDomainSlug(slug);
  }

  function resetProgress() {
    const fresh = freshProgress();
    setProgress(fresh);
    saveProgress(domainSlug, themeId, fresh);
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
          {domains.map((d) => (
            <button
              key={d.slug}
              className={`domain-btn ${d.slug === domainSlug ? "on" : ""}`}
              onClick={() => setDomainSlug(d.slug)}
            >
              {d.label}
            </button>
          ))}
          <button className="domain-btn new" onClick={() => setNewTopicOpen(true)}>
            ＋ New Topic
          </button>
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
          <Kanban domain={domainSlug} shape={graph.shape} onAuthored={onAuthored} />
        </>
      ) : (
        <GameHost
          key={`${domainSlug}:${themeId}:${view.nodeId}`}
          node={nodeById(view.nodeId)}
          theme={theme}
          gameModule={getModule(nodeById(view.nodeId).shape)}
          onSignal={(tag) => setProgress((p) => applySignal(p, view.nodeId, tag))}
          onComplete={() => handleComplete(view.nodeId)}
          onExit={() => setView({ mode: "map" })}
          onEscapeHatch={() => handleEscapeHatch(nodeById(view.nodeId))}
        />
      )}

      {modalTicket && <TicketModal ticket={modalTicket} shape={graph.shape} onClose={() => setModalTicket(null)} />}
      {newTopicOpen && <NewTopicModal onClose={() => setNewTopicOpen(false)} onCreated={afterNewTopic} />}
    </div>
  );
}
