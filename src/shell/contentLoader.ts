import type { Graph, Theme } from "../types";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return (await res.json()) as T;
}

// Reads content-as-data at runtime. Dropping a new node/theme file in and
// reloading is all it takes — no rebuild. This is what keeps self-heal cheap.
export async function loadDomain(slug: string): Promise<{ graph: Graph; themes: Theme[] }> {
  const base = `${import.meta.env.BASE_URL}content/${slug}`;
  const graph = await fetchJson<Graph>(`${base}/graph.json`);
  const themes = await Promise.all(graph.themes.map((id) => fetchJson<Theme>(`${base}/themes/${id}.json`)));
  return { graph, themes };
}

export interface DomainEntry {
  slug: string;
  label: string;
}

// The list of playable domains (folders under content/). New topics append here.
export async function loadDomainsIndex(): Promise<DomainEntry[]> {
  try {
    const idx = await fetchJson<{ domains: DomainEntry[] }>(`${import.meta.env.BASE_URL}content/domains.json`);
    if (idx?.domains?.length) return idx.domains;
  } catch {
    /* fall through to defaults */
  }
  return [
    { slug: "recursive-descent", label: "🌀 Recursion" },
    { slug: "sequence", label: "📋 Sequence / Process" },
  ];
}
