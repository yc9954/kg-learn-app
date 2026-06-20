"use client";

/**
 * Graph3D — a WebGL 3D rendering of the live prerequisite graph (an alternate
 * view to the 2D Cytoscape canvas). Built on `3d-force-graph` (Three.js under
 * the hood). It consumes the SAME `nodes`/`edges` the 2D canvas does and grows
 * incrementally: new concepts/links are appended to the force simulation as the
 * research stream lands them, so the structure inflates in 3D space.
 *
 * The library is browser-only (it touches `window`/WebGL), so it is imported
 * dynamically inside an effect and never on the server.
 */

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { Concept, PrerequisiteEdge } from "@/lib/ontology/types";

export type Graph3DProps = {
  nodes: Concept[];
  edges: PrerequisiteEdge[];
  selectedId: string | null;
  onSelect: (conceptId: string | null) => void;
  currentId?: string | null;
  nextIds?: string[];
  className?: string;
  /** Parent registers a PNG exporter here for the download button. */
  exportRef?: MutableRefObject<(() => string | null) | null>;
};

type ForceGraphInstance = {
  (el: HTMLElement): ForceGraphInstance;
  graphData: (data?: { nodes: GNode[]; links: GLink[] }) => GraphData | ForceGraphInstance;
  nodeLabel: (fn: (n: GNode) => string) => ForceGraphInstance;
  nodeColor: (fn: (n: GNode) => string) => ForceGraphInstance;
  nodeVal: (fn: (n: GNode) => number) => ForceGraphInstance;
  nodeRelSize: (n: number) => ForceGraphInstance;
  nodeOpacity: (n: number) => ForceGraphInstance;
  linkColor: (fn: (l: GLink) => string) => ForceGraphInstance;
  linkDirectionalArrowLength: (n: number) => ForceGraphInstance;
  linkDirectionalArrowRelPos: (n: number) => ForceGraphInstance;
  linkDirectionalParticles: (n: number) => ForceGraphInstance;
  linkWidth: (n: number) => ForceGraphInstance;
  backgroundColor: (c: string) => ForceGraphInstance;
  width: (n: number) => ForceGraphInstance;
  height: (n: number) => ForceGraphInstance;
  cooldownTicks: (n: number) => ForceGraphInstance;
  zoomToFit: (ms?: number, px?: number) => ForceGraphInstance;
  onEngineStop: (fn: () => void) => ForceGraphInstance;
  onNodeClick: (fn: (n: GNode) => void) => ForceGraphInstance;
  onBackgroundClick: (fn: () => void) => ForceGraphInstance;
  renderer: () => { domElement: HTMLCanvasElement };
  scene: () => unknown;
  camera: () => unknown;
  _destructor?: () => void;
};

type GNode = { id: string; name: string; state: string };
type GLink = { source: string; target: string };
type GraphData = { nodes: GNode[]; links: GLink[] };

const COLORS: Record<string, string> = {
  frontier: "#2bb7b3",
  known: "#9aa6ad",
  current: "#ffd23f",
  next: "#7ee0dd",
  selected: "#1d4ed8",
};

export default function Graph3D({
  nodes,
  edges,
  selectedId,
  onSelect,
  currentId = null,
  nextIds,
  className,
  exportRef,
}: Graph3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphInstance | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const nextSet = useMemo(() => new Set(nextIds ?? []), [nextIds]);

  function stateOf(n: Concept): string {
    if (n.id === selectedId) return "selected";
    if (n.id === currentId) return "current";
    if (nextSet.has(n.id)) return "next";
    if (n.known) return "known";
    return "frontier";
  }

  // ---- init / teardown -----------------------------------------------------
  useEffect(() => {
    let destroyed = false;
    const el = containerRef.current;
    if (!el) return;

    (async () => {
      const mod = await import("3d-force-graph");
      if (destroyed || !containerRef.current) return;
      const ForceGraph3D = (mod.default ?? mod) as unknown as (
        cfg?: Record<string, unknown>,
      ) => (el: HTMLElement) => ForceGraphInstance;

      // preserveDrawingBuffer keeps the WebGL backbuffer readable so we can
      // export the 3D view to PNG via canvas.toDataURL().
      const graph = ForceGraph3D({
        rendererConfig: { antialias: true, alpha: true, preserveDrawingBuffer: true },
      })(containerRef.current)
        .backgroundColor("rgba(0,0,0,0)")
        .nodeLabel((n) => n.name)
        .nodeColor((n) => COLORS[n.state] ?? COLORS.frontier)
        .nodeVal((n) => (n.state === "current" ? 6 : n.state === "selected" ? 5 : 3))
        .nodeRelSize(4)
        .nodeOpacity(0.95)
        .linkColor(() => "#9fb6bf")
        .linkWidth(0.6)
        .linkDirectionalArrowLength(3.5)
        .linkDirectionalArrowRelPos(1)
        .linkDirectionalParticles(2)
        .onNodeClick((n) => onSelectRef.current(n.id))
        .onBackgroundClick(() => onSelectRef.current(null))
        // Re-frame the camera so the whole graph stays in view (no clipping).
        .onEngineStop(() => graph.zoomToFit(400, 50));

      const measure = () => {
        const el2 = containerRef.current;
        if (!el2 || !graphRef.current) return;
        const w = el2.clientWidth || el2.offsetWidth;
        const h = el2.clientHeight || el2.offsetHeight;
        if (w > 0) graphRef.current.width(w);
        if (h > 0) graphRef.current.height(h);
      };

      graphRef.current = graph;
      measure();

      if (exportRef) {
        exportRef.current = () => {
          try {
            const canvas = graph.renderer().domElement;
            return canvas.toDataURL("image/png");
          } catch {
            return null;
          }
        };
      }
      // Container height may settle a frame later (flex/grid); re-measure + fit.
      requestAnimationFrame(() => {
        measure();
        graph.zoomToFit(0, 50);
      });

      const ro = new ResizeObserver(() => {
        measure();
        graphRef.current?.zoomToFit(300, 50);
      });
      ro.observe(containerRef.current);
      resizeObserverRef.current = ro;
    })();

    return () => {
      destroyed = true;
      if (exportRef) exportRef.current = null;
      resizeObserverRef.current?.disconnect();
      graphRef.current?._destructor?.();
      graphRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // ---- feed data (incremental growth preserved by the library's diff) -------
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const data: GraphData = {
      nodes: nodes.map((n) => ({ id: n.id, name: n.name, state: stateOf(n) })),
      links: edges
        .filter((e) => e.from && e.to)
        .map((e: PrerequisiteEdge) => ({ source: e.from, target: e.to })),
    };
    graph.graphData(data);
    // After the first batch lands, frame it (engine may already be stopped for
    // small static graphs, so onEngineStop alone may not fire again).
    if (data.nodes.length > 0) {
      const t = setTimeout(() => graphRef.current?.zoomToFit(400, 50), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, selectedId, currentId, nextSet]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
      data-testid="graph-3d"
    />
  );
}
