/**
 * Extractor (PRD §8 step 2). Given the current graph (and OPTIONALLY some web/
 * scholarly sources) plus a `focus` frontier concept, call the Copilot SDK
 * (`CopilotProvider.generate`, tier:"fast" → gpt-5-mini, the cost/speed tier for
 * high-volume extraction) to extract NEW `Concept`s and `PrerequisiteEdge`s.
 *
 * By default the engine runs SOURCE-FREE: with no `sources` the model uses its
 * own expert knowledge of the topic to expand the prerequisite graph. Web search
 * is an optional enrichment, not a dependency.
 *
 * Rules enforced here:
 *  - Reuse existing concept names; only add genuinely new concepts
 *    (dedupe by normalized name + fuzzy-merge near-duplicates → no sibling dups).
 *  - Reject any edge where `wouldCreateCycle()` is true (the graph stays a DAG).
 *  - Tag every concept with the `WebSource`(s) that justified it (for citation).
 *
 * All model calls go through `CopilotProvider` only (PRD §4.1).
 */

import { CopilotProvider } from "@/lib/ai/copilot";
import { wouldCreateCycle } from "@/lib/ontology/invariants";
import type {
  Concept,
  KnowledgeGraph,
  PrerequisiteEdge,
  WebSource,
} from "@/lib/ontology/types";

/** A model-call shim so extraction can be unit-tested offline with a mock. */
export type GenerateFn = (
  prompt: string,
  opts?: { tier?: "quality" | "fast"; system?: string },
) => Promise<string>;

const defaultGenerate: GenerateFn = (prompt, opts) =>
  CopilotProvider.generate(prompt, opts);

/** Result of one extraction round, ready for the orchestrator to stream. */
export type ExtractionResult = {
  /** Concepts not already present in the graph (deduped, slug-ids assigned). */
  newConcepts: Concept[];
  /** Edges accepted as DAG-safe (both endpoints exist after merge). */
  newEdges: PrerequisiteEdge[];
  /** conceptId → the WebSource(s) that justified it (for later citation). */
  conceptSources: Map<string, WebSource[]>;
  /** Edges the model proposed but we rejected (cycle / dangling) — for logs. */
  rejectedEdges: { edge: PrerequisiteEdge; reason: string }[];
};

/* -------------------------------------------------------------------------- */
/* Name normalization + slug ids                                              */
/* -------------------------------------------------------------------------- */

/** Canonical form used for dedupe: lowercase, de-punctuated, de-pluralized. */
export function normalizeName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  // naive singularization of the last token so "graphs" == "graph"
  return base.replace(/\b(\w+?)(ies)\b/g, "$1y").replace(/\b(\w+?)s\b/g, "$1");
}

/** Stable, human-readable id derived from the concept name. */
export function slugId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "concept";
}

/** Token Jaccard similarity for fuzzy near-duplicate detection. */
function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean));
  const sb = new Set(b.split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

const FUZZY_MERGE_THRESHOLD = 0.8;

/**
 * Resolve a proposed concept name to an EXISTING concept id if it is the same
 * or a near-duplicate; otherwise return null. `index` maps normalized name → id.
 */
function resolveExisting(
  name: string,
  index: Map<string, string>,
): string | null {
  const norm = normalizeName(name);
  const exact = index.get(norm);
  if (exact) return exact;
  for (const [existingNorm, id] of index) {
    if (jaccard(norm, existingNorm) >= FUZZY_MERGE_THRESHOLD) return id;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Prompt + parsing                                                           */
/* -------------------------------------------------------------------------- */

const EXTRACT_SYSTEM = `You are a precise knowledge-graph extraction engine.
You read source excerpts about a topic and output ONLY a strict JSON object that
identifies the atomic CONCEPTS a learner must understand, and the PREREQUISITE
relationships between them (which concept must be learned before which).

Rules:
- Output JSON ONLY. No prose, no markdown fences.
- A prerequisite edge {"from","to"} means: you must learn "from" BEFORE "to".
- Never create cycles (the graph must be a DAG).
- Prefer reusing the EXACT names of concepts already in the graph.
- Keep concept names short noun phrases (2-5 words). Definitions are 1 sentence;
  summaries are 1-2 sentences.`;

type RawConcept = {
  name?: string;
  definition?: string;
  summary?: string;
};
type RawEdge = { from?: string; to?: string };
type RawExtraction = { concepts?: RawConcept[]; edges?: RawEdge[] };

function buildPrompt(
  topic: string,
  sources: WebSource[],
  graph: KnowledgeGraph,
  focus?: string,
): string {
  const existing = graph.nodes.map((n) => n.name).join(", ") || "(none yet)";
  const sourceText = sources
    .slice(0, 8)
    .map(
      (s, i) =>
        `[#${i + 1}] ${s.title}\n${s.url}\n${(s.snippet || "").slice(0, 800)}`,
    )
    .join("\n\n");

  const focusLine =
    focus && focus.trim()
      ? `FOCUS: expand the DIRECT PREREQUISITE concepts a learner must understand in order to grasp: ${focus.trim()}. Add those prerequisites (and, where helpful, their prerequisites) and the edges connecting them.\n\n`
      : "";

  return `TOPIC: ${topic}

${focusLine}CONCEPTS ALREADY IN THE GRAPH (reuse these names exactly when relevant):
${existing}

SOURCES:
${sourceText || "(no external sources — use your own expert knowledge of the topic to identify the concepts and prerequisite relationships)"}

Return JSON shaped exactly:
{
  "concepts": [{"name": string, "definition": string, "summary": string}],
  "edges": [{"from": concept-name, "to": concept-name}]
}
Include both brand-new concepts AND edges connecting new concepts to each other
and to existing ones. Aim for high-signal prerequisites, not exhaustive links.`;
}

/** Tolerant JSON extraction: handles fenced blocks and surrounding prose. */
export function parseExtraction(raw: string): RawExtraction {
  if (!raw || !raw.trim()) return {};
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Grab the outermost {...} if there is leading/trailing prose.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }
  try {
    return JSON.parse(text) as RawExtraction;
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Extract new concepts + DAG-safe edges from `sources` given the `graph` so far.
 * Pure with respect to `graph` (does not mutate it); the orchestrator applies
 * and streams the results. Inject `generate` to test offline without a model.
 */
export async function extractConcepts(
  topic: string,
  sources: WebSource[],
  graph: KnowledgeGraph,
  generate: GenerateFn = defaultGenerate,
  focus?: string,
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    newConcepts: [],
    newEdges: [],
    conceptSources: new Map(),
    rejectedEdges: [],
  };

  let parsed: RawExtraction;
  try {
    const raw = await generate(buildPrompt(topic, sources, graph, focus), {
      tier: "fast",
      system: EXTRACT_SYSTEM,
    });
    parsed = parseExtraction(raw);
  } catch (err) {
    console.warn("[research/extract] generate failed — empty round.", err);
    return result;
  }

  // Index of normalized-name → concept id, seeded with the existing graph and
  // grown as we accept new concepts (so within-round dups also merge).
  const index = new Map<string, string>();
  for (const n of graph.nodes) index.set(normalizeName(n.name), n.id);
  const usedIds = new Set(graph.nodes.map((n) => n.id));

  // name (as the model wrote it) → resolved concept id, for edge wiring.
  const nameToId = new Map<string, string>();
  for (const n of graph.nodes) nameToId.set(n.name.toLowerCase(), n.id);

  const rawConcepts = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  for (const rc of rawConcepts) {
    const name = (rc.name ?? "").trim();
    if (!name) continue;

    const existingId = resolveExisting(name, index);
    if (existingId) {
      // Known concept — just record the alias + attach citing sources.
      nameToId.set(name.toLowerCase(), existingId);
      mergeSources(result.conceptSources, existingId, sources);
      continue;
    }

    // Genuinely new concept — assign a unique slug id.
    let id = slugId(name);
    let i = 2;
    while (usedIds.has(id)) id = `${slugId(name)}-${i++}`;
    usedIds.add(id);

    const concept: Concept = {
      id,
      name,
      definition: (rc.definition ?? "").trim() || name,
      summary: (rc.summary ?? rc.definition ?? "").trim() || name,
      known: false,
    };
    result.newConcepts.push(concept);
    index.set(normalizeName(name), id);
    nameToId.set(name.toLowerCase(), id);
    mergeSources(result.conceptSources, id, sources);
  }

  // Working graph copy that includes the freshly accepted concepts so cycle
  // checks see them; we add accepted edges to it incrementally.
  const working: KnowledgeGraph = {
    ...graph,
    nodes: [...graph.nodes, ...result.newConcepts],
    edges: [...graph.edges],
  };

  const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
  for (const re of rawEdges) {
    const fromName = (re.from ?? "").trim();
    const toName = (re.to ?? "").trim();
    if (!fromName || !toName) continue;

    const fromId = nameToId.get(fromName.toLowerCase()) ??
      resolveExisting(fromName, index);
    const toId = nameToId.get(toName.toLowerCase()) ??
      resolveExisting(toName, index);

    if (!fromId || !toId) {
      result.rejectedEdges.push({
        edge: { from: fromId ?? fromName, to: toId ?? toName },
        reason: "dangling endpoint (concept not in graph)",
      });
      continue;
    }
    const edge: PrerequisiteEdge = { from: fromId, to: toId };

    // Skip exact duplicates of already-accepted/known edges.
    if (working.edges.some((e) => e.from === edge.from && e.to === edge.to)) {
      continue;
    }
    if (wouldCreateCycle(working, edge)) {
      result.rejectedEdges.push({ edge, reason: "would create a cycle" });
      continue;
    }
    working.edges.push(edge);
    result.newEdges.push(edge);
  }

  return result;
}

function mergeSources(
  map: Map<string, WebSource[]>,
  conceptId: string,
  sources: WebSource[],
) {
  if (sources.length === 0) return;
  const existing = map.get(conceptId) ?? [];
  const seen = new Set(existing.map((s) => s.url || s.title));
  for (const s of sources.slice(0, 4)) {
    const key = s.url || s.title;
    if (key && !seen.has(key)) {
      existing.push(s);
      seen.add(key);
    }
  }
  map.set(conceptId, existing);
}
