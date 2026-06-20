/**
 * Search layer (PRD §8 step 2). A provider-agnostic `WebSearchProvider`
 * interface plus a default Tavily implementation and an arXiv/scholarly fetch.
 *
 * Web-search providers are INTENTIONALLY EXEMPT from the Azure-only rule
 * (PRD §10): they are egress, not a host or a model backend.
 *
 * Hard requirement: degrade gracefully. If `TAVILY_API_KEY` is missing or a
 * request fails, return an empty `WebSource[]` and log — NEVER throw/crash the
 * research loop.
 *
 * Env:
 *   TAVILY_API_KEY  — Tavily web-search key (https://tavily.com). Optional
 *                     locally; without it web search returns [] (arXiv still
 *                     works, it needs no key).
 */

import type { WebSource } from "@/lib/ontology/types";

/** Options accepted by a search call. */
export type SearchOptions = {
  /** Max results to return (provider may cap lower). */
  maxResults?: number;
  /** Bias toward recent / scholarly results when the provider supports it. */
  topic?: "general" | "scholarly";
};

/** A pluggable web-search backend. Implementations must never throw. */
export interface WebSearchProvider {
  readonly name: string;
  /** True when the provider is actually usable (e.g. has its API key). */
  isConfigured(): boolean;
  /** Run a search; always resolves (returns [] on any failure). */
  search(query: string, opts?: SearchOptions): Promise<WebSource[]>;
}

const DEFAULT_MAX_RESULTS = 6;

function log(scope: string, msg: string, err?: unknown) {
  // Keep logging dependency-free; the worker captures stdout/stderr.
  if (err !== undefined) {
    console.warn(`[research/search:${scope}] ${msg}`, err);
  } else {
    console.warn(`[research/search:${scope}] ${msg}`);
  }
}

function dedupeByUrl(sources: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const s of sources) {
    const key = (s.url || s.title).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Tavily                                                                     */
/* -------------------------------------------------------------------------- */

type TavilyResult = {
  url?: string;
  title?: string;
  content?: string;
};

type TavilyResponse = {
  results?: TavilyResult[];
  answer?: string;
};

/**
 * Default web-search provider backed by Tavily's `/search` API.
 * Reads `TAVILY_API_KEY`. Returns [] when unconfigured or on error.
 */
export class TavilySearchProvider implements WebSearchProvider {
  readonly name = "tavily";
  private readonly apiKey: string | undefined;
  private readonly endpoint = "https://api.tavily.com/search";

  constructor(apiKey: string | undefined = process.env.TAVILY_API_KEY) {
    this.apiKey = apiKey && apiKey.trim().length > 0 ? apiKey.trim() : undefined;
  }

  isConfigured(): boolean {
    return this.apiKey !== undefined;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<WebSource[]> {
    if (!this.isConfigured()) {
      log("tavily", "TAVILY_API_KEY not set — skipping web search (returning []).");
      return [];
    }
    const maxResults = opts.maxResults ?? DEFAULT_MAX_RESULTS;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          max_results: maxResults,
          search_depth: opts.topic === "scholarly" ? "advanced" : "basic",
          include_answer: false,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        log("tavily", `HTTP ${res.status} ${res.statusText} — returning [].`);
        return [];
      }
      const data = (await res.json()) as TavilyResponse;
      const results = data.results ?? [];
      return dedupeByUrl(
        results
          .filter((r) => r.url || r.title)
          .map((r) => ({
            url: r.url ?? "",
            title: r.title ?? r.url ?? "Untitled",
            snippet: (r.content ?? "").slice(0, 1200),
          })),
      );
    } catch (err) {
      log("tavily", "search failed — returning [].", err);
      return [];
    }
  }
}

/* -------------------------------------------------------------------------- */
/* arXiv (scholarly) — keyless                                                */
/* -------------------------------------------------------------------------- */

/**
 * Fetch scholarly results from the arXiv Atom API. Needs no API key, so it
 * always runs (subject to network availability) and degrades to [] on error.
 */
export async function searchArxiv(
  query: string,
  opts: SearchOptions = {},
): Promise<WebSource[]> {
  const maxResults = opts.maxResults ?? DEFAULT_MAX_RESULTS;
  try {
    const url =
      "https://export.arxiv.org/api/query?" +
      new URLSearchParams({
        search_query: `all:${query}`,
        start: "0",
        max_results: String(maxResults),
        sortBy: "relevance",
      }).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(url, {
      headers: { "user-agent": "kg-learn-research/1.0" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      log("arxiv", `HTTP ${res.status} ${res.statusText} — returning [].`);
      return [];
    }
    const xml = await res.text();
    return dedupeByUrl(parseArxivAtom(xml));
  } catch (err) {
    log("arxiv", "fetch failed — returning [].", err);
    return [];
  }
}

/** Minimal, dependency-free Atom parser for arXiv `<entry>` elements. */
function parseArxivAtom(xml: string): WebSource[] {
  const out: WebSource[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const entry = m[1];
    const title = decodeEntities(
      (entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").trim(),
    );
    const summary = decodeEntities(
      (entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "").trim(),
    );
    // Prefer the canonical abstract link (the <id> element).
    const id = (entry.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? "").trim();
    if (!title) continue;
    out.push({
      url: id,
      title,
      snippet: summary.replace(/\s+/g, " ").slice(0, 1200),
    });
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/* -------------------------------------------------------------------------- */
/* Aggregate helpers                                                          */
/* -------------------------------------------------------------------------- */

/** The default provider instance (Tavily, reading env). */
export const defaultSearchProvider: WebSearchProvider = new TavilySearchProvider();

/**
 * Search the web + arXiv in parallel and return a merged, de-duplicated
 * `WebSource[]`. Always resolves; partial failures degrade to fewer sources.
 */
export async function searchAll(
  query: string,
  opts: SearchOptions = {},
  provider: WebSearchProvider = defaultSearchProvider,
): Promise<WebSource[]> {
  const [web, scholarly] = await Promise.all([
    provider.search(query, opts),
    searchArxiv(query, { ...opts, topic: "scholarly" }),
  ]);
  return dedupeByUrl([...web, ...scholarly]);
}
