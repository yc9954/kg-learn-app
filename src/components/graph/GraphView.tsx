"use client";

/**
 * GraphView — the live knowledge-graph surface (PRD §8 step 4; AC-7/8).
 *
 * Composes:
 *   - `useGraphStream`  → folds SSE `GraphEvent`s into live graph state.
 *   - `GraphCanvas`     → Cytoscape view that grows + animates as events land.
 *   - a status badge    → researching (pulse) → converged/stopped (settle).
 *   - a node legend      → the node-state colour key.
 *   - a detail panel     → click a node to read its definition/summary (+ sources).
 *
 * Two modes, mutually exclusive:
 *   - LIVE:   pass `sessionId` (from `POST /api/research`) → streams over SSE.
 *   - STATIC: pass `graph` (a persisted/known graph) → renders without a stream.
 * Passing neither renders a clean empty state (the initial UI).
 */

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Concept, KnowledgeGraph } from "@/lib/ontology/types";
import { useGraphStream } from "@/lib/graph/useGraphStream";
import GraphCanvas from "./GraphCanvas";
import styles from "./graph.module.css";

const Graph3D = dynamic(() => import("./Graph3D"), { ssr: false });

type ViewMode = "2d" | "3d";

export type GraphViewProps = {
  /** Live research session id from `POST /api/research`. */
  sessionId?: string | null;
  /** Pre-loaded graph for a static (non-streaming) render. */
  graph?: KnowledgeGraph;
  /** Active lecture target (optional; lecture-generator integration). */
  currentId?: string | null;
  /** Upcoming lecture targets (optional). */
  nextIds?: string[];
};

export default function GraphView({
  sessionId,
  graph,
  currentId = null,
  nextIds,
}: GraphViewProps) {
  const { nodes, edges, status, error, connection, eventCount } = useGraphStream(
    sessionId ?? null,
    graph,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("2d");

  const selected: Concept | undefined = useMemo(
    () => nodes.find((n) => n.id === selectedId),
    [nodes, selectedId],
  );

  const isEmpty = nodes.length === 0;

  return (
    <div className={styles.wrap} data-status={status} data-connection={connection}>
      {view === "3d" ? (
        <Graph3D
          className={styles.canvas}
          nodes={nodes}
          edges={edges}
          selectedId={selectedId}
          onSelect={setSelectedId}
          currentId={currentId}
          nextIds={nextIds}
        />
      ) : (
        <GraphCanvas
          className={styles.canvas}
          nodes={nodes}
          edges={edges}
          status={status}
          selectedId={selectedId}
          onSelect={setSelectedId}
          currentId={currentId}
          nextIds={nextIds}
        />
      )}

      <div className={styles.viewToggle} role="group" aria-label="Graph view mode">
        <button
          type="button"
          className={view === "2d" ? styles.viewBtnActive : styles.viewBtn}
          onClick={() => setView("2d")}
        >
          2D
        </button>
        <button
          type="button"
          className={view === "3d" ? styles.viewBtnActive : styles.viewBtn}
          onClick={() => setView("3d")}
        >
          3D
        </button>
      </div>

      <StatusBadge
        status={status}
        connection={connection}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        eventCount={eventCount}
      />

      <Legend />

      {error && <div className={styles.error}>{error}</div>}

      {isEmpty && (
        <div className={styles.empty}>
          {sessionId
            ? connection === "open" || connection === "connecting"
              ? "Researching… concepts will appear here as they are discovered."
              : "Waiting for the research stream…"
            : "Enter a topic to start building its knowledge graph."}
        </div>
      )}

      {selected && (
        <DetailPanel concept={selected} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function StatusBadge({
  status,
  connection,
  nodeCount,
  edgeCount,
  eventCount,
}: {
  status: string;
  connection: string;
  nodeCount: number;
  edgeCount: number;
  eventCount: number;
}) {
  const dotClass =
    status === "researching"
      ? styles.dotResearching
      : status === "converged"
        ? styles.dotConverged
        : status === "stopped"
          ? styles.dotStopped
          : styles.dot;

  const label =
    status === "researching"
      ? connection === "reconnecting"
        ? "reconnecting…"
        : "researching"
      : status;

  return (
    <div className={styles.status}>
      <span className={`${styles.dot} ${dotClass}`} />
      <span>{label}</span>
      <span className={styles.counts}>
        · {nodeCount} concepts · {edgeCount} links
        {eventCount > 0 ? ` · ${eventCount} events` : ""}
      </span>
    </div>
  );
}

function Legend() {
  return (
    <div className={styles.legend} aria-label="Node legend">
      <span className={styles.legendItem}>
        <span className={`${styles.swatch} ${styles.swFrontier}`} /> frontier
      </span>
      <span className={styles.legendItem}>
        <span className={`${styles.swatch} ${styles.swCurrent}`} /> current
      </span>
      <span className={styles.legendItem}>
        <span className={`${styles.swatch} ${styles.swNext}`} /> next
      </span>
      <span className={styles.legendItem}>
        <span className={`${styles.swatch} ${styles.swKnown}`} /> known
      </span>
    </div>
  );
}

/**
 * Sources are not part of the `Concept` ontology contract, but a concept may
 * carry them on an optional `sources` field in richer payloads — render them
 * defensively if present (AC-8 "+ sources if available").
 */
type ConceptWithSources = Concept & {
  sources?: { url: string; title?: string }[];
};

function DetailPanel({
  concept,
  onClose,
}: {
  concept: Concept;
  onClose: () => void;
}) {
  const sources = (concept as ConceptWithSources).sources;
  return (
    <aside className={styles.panel} role="dialog" aria-label={concept.name}>
      <button className={styles.panelClose} onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2 className={styles.panelTitle}>{concept.name}</h2>
      {concept.known && <span className={styles.panelTag}>already known</span>}

      <div className={styles.panelLabel}>Definition</div>
      <p className={styles.panelText}>{concept.definition || "—"}</p>

      <div className={styles.panelLabel}>Summary</div>
      <p className={styles.panelText}>{concept.summary || "—"}</p>

      {sources && sources.length > 0 && (
        <>
          <div className={styles.panelLabel}>Sources</div>
          <ul className={styles.panelSources}>
            {sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
