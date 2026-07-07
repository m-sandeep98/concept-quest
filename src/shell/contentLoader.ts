import type { Graph, Theme } from "../types";

type Retriable = Error & { retriable?: boolean };
const err = (msg: string, retriable: boolean): Retriable => Object.assign(new Error(msg), { retriable });

// Fetch + parse one JSON document, defending against the one failure that
// actually bites here: a dev server or static host answers a MISSING file with
// its SPA index.html (HTTP 200 + text/html). Calling res.json() on that HTML
// throws a cryptic "unexpected token <" (Safari: "did not match the expected
// pattern") and takes the whole topic down. We detect it and fail clearly.
async function fetchJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw err(`network error — ${url}`, true);
  }
  if (!res.ok) throw err(`${res.status} ${res.statusText} — ${url}`, res.status === 404 || res.status >= 500);

  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    // Got HTML where JSON was expected — the file isn't being served (yet).
    // Transient right after authoring, so mark it retriable.
    throw err(`expected JSON but received HTML (file not found?) — ${url}`, true);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    // Malformed content won't fix itself on retry — surface it immediately.
    throw err(`invalid JSON — ${url}`, false);
  }
}

// A freshly authored topic can lose a race with the dev server: the file is on
// disk but not yet visible to the next request. Retry the transient class a few
// times with a short backoff (~3s worst case) before giving up.
async function fetchJsonRetry<T>(url: string, tries = 6, baseDelay = 200): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fetchJson<T>(url);
    } catch (e) {
      last = e;
      if (i === tries - 1 || !(e as Retriable).retriable) break;
      await new Promise((r) => setTimeout(r, baseDelay * (i + 1)));
    }
  }
  throw last;
}

// Reads content-as-data at runtime. Dropping a new node/theme file in and
// reloading is all it takes — no rebuild. This is what keeps self-heal cheap.
export async function loadDomain(slug: string): Promise<{ graph: Graph; themes: Theme[] }> {
  const base = `${import.meta.env.BASE_URL}content/${slug}`;
  const graph = await fetchJsonRetry<Graph>(`${base}/graph.json`);
  const themes = await Promise.all(graph.themes.map((id) => fetchJsonRetry<Theme>(`${base}/themes/${id}.json`)));
  return { graph, themes };
}

export interface DomainEntry {
  slug: string;
  label: string;
}

// The list of playable domains (folders under content/). New topics append here.
export async function loadDomainsIndex(): Promise<DomainEntry[]> {
  try {
    const idx = await fetchJsonRetry<{ domains: DomainEntry[] }>(`${import.meta.env.BASE_URL}content/domains.json`);
    if (idx?.domains?.length) return idx.domains;
  } catch {
    /* fall through to defaults */
  }
  return [
    { slug: "character-descent", label: "🌀 Recursion" },
    { slug: "binary-search", label: "🔍 Binary Search" },
    { slug: "batch-packing", label: "🧩 Batch Packing" },
  ];
}
