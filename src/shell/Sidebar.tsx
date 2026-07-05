import type { DomainEntry } from "./contentLoader";

export default function Sidebar({
  domains,
  current,
  onSelect,
  onNew,
}: {
  domains: DomainEntry[];
  current: string;
  onSelect: (slug: string) => void;
  onNew: () => void;
}) {
  return (
    <nav className="sidebar">
      <div className="sidebar-title">Topics</div>
      <div className="topic-tabs">
        {domains.map((d) => (
          <button key={d.slug} className={`topic-tab ${d.slug === current ? "on" : ""}`} onClick={() => onSelect(d.slug)}>
            {d.label}
          </button>
        ))}
      </div>
      <button className="topic-tab new" onClick={onNew}>
        ＋ New Topic
      </button>
    </nav>
  );
}
