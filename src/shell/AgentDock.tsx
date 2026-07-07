import type { Dispatch, ReactNode, SetStateAction } from "react";

export default function AgentDock({
  tab,
  setTab,
  collapsed,
  setCollapsed,
  running,
  authorQueue,
  terminal,
}: {
  tab: "author" | "terminal";
  setTab: (t: "author" | "terminal") => void;
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  running: boolean;
  authorQueue: ReactNode;
  terminal: ReactNode;
}) {
  return (
    <div className={`dock ${collapsed ? "collapsed" : ""}`}>
      <div className="dock-head">
        <div className="dock-tabs">
          <button className={`dock-tab ${tab === "author" ? "on" : ""}`} onClick={() => setTab("author")}>
            🎫 Author Queue
          </button>
          <button className={`dock-tab ${tab === "terminal" ? "on" : ""}`} onClick={() => setTab("terminal")}>
            🖥️ Claude Terminal {running && <span className="run-dot" />}
          </button>
        </div>
        <button className="dock-collapse" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "▲ expand" : "▼ collapse"}
        </button>
      </div>
      {!collapsed && <div className="dock-body">{tab === "author" ? authorQueue : terminal}</div>}
    </div>
  );
}
