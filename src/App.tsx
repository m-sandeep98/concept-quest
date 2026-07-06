import { useEffect, useState } from "react";
import type { Graph, GraphNode, Theme } from "./types";
import { loadDomain, loadDomainsIndex, type DomainEntry } from "./shell/contentLoader";
import { getModule } from "./archetypes/registry";
import QuestMap from "./shell/Map";
import GameHost from "./shell/GameHost";
import TicketModal from "./shell/TicketModal";
import Kanban from "./shell/Kanban";
import NewTopicModal from "./shell/NewTopicModal";
import Sidebar from "./shell/Sidebar";
import AgentDock from "./shell/AgentDock";
import Terminal from "./shell/Terminal";
import { useAuthoring } from "./shell/useAuthoring";
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
  const [reloadKey, setReloadKey] = useState(0);
  const [dockTab, setDockTab] = useState<"kanban" | "terminal">("kanban");
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const authoring = useAuthoring();

  useEffect(() => {
    loadDomainsIndex().then((d) => {
      setDomains(d);
      setDomainSlug((cur) => cur || d[0]?.slug || "");
    });
  }, []);

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
  }, [domainSlug, reloadKey]);

  useEffect(() => {
    if (graph && themeId && themes.some((t) => t.id === themeId)) saveProgress(domainSlug, themeId, progress);
  }, [domainSlug, themeId, themes, graph, progress]);

  const theme = themes.find((t) => t.id === themeId);
  const nodeById = (id: string) => graph!.nodes.find((n) => n.id === id)!;
  const ready = !!(graph && themeId && theme);

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

  async function afterNewTopic(slug: string) {
    const d = await loadDomainsIndex();
    setDomains(d);
    setThemeId("");
    setDomainSlug(slug);
  }

  function resetProgress() {
    const fresh = freshProgress();
    setProgress(fresh);
    saveProgress(domainSlug, themeId, fresh);
    setView({ mode: "map" });
  }

  // Author a heal ticket through the streaming terminal, then hot-reload.
  async function authorTicketStreaming(id: string) {
    setDockTab("terminal");
    setDockCollapsed(false);
    const r = (await authoring.startHeal(id)) as { nodeId?: string };
    if (r?.nodeId) await onAuthored(r.nodeId);
    return r;
  }

  // Author a whole new topic through the streaming terminal, then switch to it.
  async function submitNewTopic(concept: string) {
    setNewTopicOpen(false);
    setDockTab("terminal");
    setDockCollapsed(false);
    try {
      const r = (await authoring.startTopic(concept)) as { slug?: string };
      if (r?.slug) await afterNewTopic(r.slug);
    } catch {
      /* error is shown in the terminal */
    }
  }

  const agent =
    authoring.status === "running"
      ? { cls: "run", label: "authoring" }
      : authoring.status === "error"
        ? { cls: "err", label: "error" }
        : authoring.status === "done"
          ? { cls: "ok", label: "ready" }
          : { cls: "idle", label: "standby" };

  return (
    <div className="app">
      <header className="cmd">
        <div className="cmd-brand">
          <svg className="cmd-mark" width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M16 3 L27 9.5 V22.5 L16 29 L5 22.5 V9.5 Z" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
            <g className="spin">
              <path d="M16 7 L23.5 19.5 L8.5 19.5 Z" stroke="currentColor" strokeWidth="1" opacity="0.4" />
              <circle cx="16" cy="7" r="1.7" fill="currentColor" />
              <circle cx="23.5" cy="19.5" r="1.7" fill="currentColor" />
              <circle cx="8.5" cy="19.5" r="1.7" fill="currentColor" />
            </g>
            <circle cx="16" cy="16" r="3.2" fill="currentColor" />
          </svg>
          <div className="cmd-id">
            <h1 className="cmd-word">
              Concept<b>Quest</b>
            </h1>
            <p className="cmd-sub">
              {ready ? (
                <>
                  archetype <code>{graph!.shape}</code> · teaching <strong>{theme!.subject}</strong>
                </>
              ) : (
                "gamify any concept into a playable game"
              )}
            </p>
          </div>
        </div>
        <div className="cmd-right">
          <span className={`agent-chip ${agent.cls}`}>
            <i className="agent-dot" />
            agent · {agent.label}
          </span>
          <span
            className="policy-note"
            title="Authoring runs `claude -p` on YOUR local Claude account. Shipping this to many users requires each user's own account/API key — see README."
          >
            🔒 local Claude account
          </span>
        </div>
      </header>

      <div className="layout">
        <Sidebar domains={domains} current={domainSlug} onSelect={setDomainSlug} onNew={() => setNewTopicOpen(true)} />
        <main className="main">
          {error ? (
            <div className="app-msg error">
              <p className="err-title">Couldn't load this topic</p>
              <p className="err-detail">{error}</p>
              <button className="rd-run ghost" onClick={() => setReloadKey((k) => k + 1)}>
                ↻ Retry
              </button>
            </div>
          ) : !ready ? (
            <div className="app-msg">Loading…</div>
          ) : view.mode === "map" ? (
            <QuestMap
              graph={graph!}
              theme={theme!}
              themes={themes}
              progress={progress}
              onOpen={(id) => setView({ mode: "play", nodeId: id })}
              onSwitchTheme={switchTheme}
              onReset={resetProgress}
            />
          ) : (
            <GameHost
              key={`${domainSlug}:${themeId}:${view.nodeId}`}
              node={nodeById(view.nodeId)}
              theme={theme!}
              gameModule={getModule(nodeById(view.nodeId).shape)}
              onSignal={(tag) => setProgress((p) => applySignal(p, view.nodeId, tag))}
              onComplete={() => handleComplete(view.nodeId)}
              onExit={() => setView({ mode: "map" })}
              onEscapeHatch={() => handleEscapeHatch(nodeById(view.nodeId))}
            />
          )}
        </main>
      </div>

      <AgentDock
        tab={dockTab}
        setTab={setDockTab}
        collapsed={dockCollapsed}
        setCollapsed={setDockCollapsed}
        running={authoring.running}
        kanban={
          ready ? (
            <Kanban domain={domainSlug} shape={graph!.shape} onAuthor={authorTicketStreaming} />
          ) : (
            <div className="app-msg">…</div>
          )
        }
        terminal={<Terminal entries={authoring.entries} status={authoring.status} error={authoring.error} />}
      />

      {modalTicket && ready && <TicketModal ticket={modalTicket} shape={graph!.shape} onClose={() => setModalTicket(null)} />}
      {newTopicOpen && <NewTopicModal onClose={() => setNewTopicOpen(false)} onSubmit={submitNewTopic} />}
    </div>
  );
}
