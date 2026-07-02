import type { Graph, Theme } from "../types";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return (await res.json()) as T;
}

// Reads content-as-data at runtime. Dropping a new node/theme file in and
// reloading is all it takes — no rebuild. This is what keeps self-heal cheap.
export async function loadDomain(shape: string): Promise<{ graph: Graph; themes: Theme[] }> {
  const base = `${import.meta.env.BASE_URL}content/${shape}`;
  const graph = await fetchJson<Graph>(`${base}/graph.json`);
  const themes = await Promise.all(graph.themes.map((id) => fetchJson<Theme>(`${base}/themes/${id}.json`)));
  return { graph, themes };
}
