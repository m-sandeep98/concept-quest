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
  // Group sub-games under the topic they were spun off from; everything else is a root.
  const bySlug = new Set(domains.map((d) => d.slug));
  const childrenOf = new Map<string, DomainEntry[]>();
  const roots: DomainEntry[] = [];
  for (const d of domains) {
    if (d.parent && bySlug.has(d.parent)) {
      const list = childrenOf.get(d.parent) ?? [];
      list.push(d);
      childrenOf.set(d.parent, list);
    } else {
      roots.push(d);
    }
  }

  const tab = (d: DomainEntry, sub = false) => (
    <button
      key={d.slug}
      className={`topic-tab ${sub ? "sub" : ""} ${d.slug === current ? "on" : ""}`}
      onClick={() => onSelect(d.slug)}
    >
      {sub && <span className="topic-branch" aria-hidden>↳</span>}
      {d.label}
    </button>
  );

  return (
    <nav className="sidebar">
      <div className="sidebar-title">Topics</div>
      <div className="topic-tabs">
        {roots.map((d) => (
          <div key={d.slug} className="topic-group">
            {tab(d)}
            {(childrenOf.get(d.slug) ?? []).map((c) => tab(c, true))}
          </div>
        ))}
      </div>
      <button className="topic-tab new" onClick={onNew}>
        ＋ New Topic
      </button>
    </nav>
  );
}
