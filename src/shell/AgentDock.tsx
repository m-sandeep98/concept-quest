import type { Dispatch, ReactNode, SetStateAction } from "react";

export default function AgentDock({
  tab,
  setTab,
  collapsed,
  setCollapsed,
  running,
  kanban,
  terminal,
}: {
  tab: "kanban" | "terminal";
  setTab: (t: "kanban" | "terminal") => void;
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  running: boolean;
  kanban: ReactNode;
  terminal: ReactNode;
}) {
  return (
    <div className={`dock ${collapsed ? "collapsed" : ""}`}>
      <div className="dock-head">
        <div className="dock-tabs">
          <button className={`dock-tab ${tab === "kanban" ? "on" : ""}`} onClick={() => setTab("kanban")}>
            🎫 Kanban
          </button>
          <button className={`dock-tab ${tab === "terminal" ? "on" : ""}`} onClick={() => setTab("terminal")}>
            🖥️ Claude Terminal {running && <span className="run-dot" />}
          </button>
        </div>
        <button className="dock-collapse" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "▲ expand" : "▼ collapse"}
        </button>
      </div>
      {!collapsed && <div className="dock-body">{tab === "kanban" ? kanban : terminal}</div>}
    </div>
  );
}
