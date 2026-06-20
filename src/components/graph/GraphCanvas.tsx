"use client";

/**
 * GraphCanvas — imperative Cytoscape.js view that grows the prerequisite DAG
 * LIVE as SSE events arrive (PRD §8 step 4; AC-7/8). The "growth is visceral"
 * requirement drives the design choices here:
 *
 *  - We drive Cytoscape imperatively (a `cy` ref), NOT via react-cytoscapejs,
 *    so we can APPEND new elements and animate them in instead of re-rendering /
 *    re-laying-out the whole graph on every event.
 *  - New nodes fade + scale in (style transitions) and are seeded at a
 *    prerequisite's position so they appear to "sprout" from what they depend
 *    on; new edges fade in (a draw-in affordance).
 *  - The fcose layout runs on a TRAILING THROTTLE (not per-event) and seeds from
 *    existing positions (`randomize: false`) so the graph settles smoothly
 *    rather than jumping; animation auto-disables past a node-count threshold to
 *    stay smooth with hundreds of nodes.
 *
 * Node-state legend (see styling below):
 *   known    → dimmed/desaturated (pruned: learner already knows it)
 *   current  → bright highlight ring (the active lecture target)
 *   next     → amber highlight (an upcoming lecture target)
 *   frontier → default teal (unexplored / to-be-taught)
 *   selected → thick accent outline (click selection)
 */

import { useEffect, useRef } from "react";
import cytoscape, {
  type Core,
  type ElementDefinition,
  type NodeSingular,
} from "cytoscape";
import fcose from "cytoscape-fcose";
import type { Concept, GraphStatus, PrerequisiteEdge } from "@/lib/ontology/types";

// Register the fcose layout exactly once (module-scoped guard).
let fcoseRegistered = false;
function ensureFcose() {
  if (!fcoseRegistered) {
    cytoscape.use(fcose);
    fcoseRegistered = true;
  }
}

const LAYOUT_THROTTLE_MS = 350;
const ANIMATE_NODE_LIMIT = 160; // disable per-tick animation past this for smoothness
const ENTER_MS = 450;

const edgeId = (e: PrerequisiteEdge) => `${e.from}\u0000${e.to}`;

export type GraphCanvasProps = {
  nodes: Concept[];
  edges: PrerequisiteEdge[];
  status: GraphStatus;
  selectedId: string | null;
  onSelect: (conceptId: string | null) => void;
  /** Active lecture target (optional; set by lecture-generator integration). */
  currentId?: string | null;
  /** Upcoming lecture targets (optional). */
  nextIds?: string[];
  className?: string;
};

export default function GraphCanvas({
  nodes,
  edges,
  status,
  selectedId,
  onSelect,
  currentId = null,
  nextIds,
  className,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const knownNodeIds = useRef<Set<string>>(new Set());
  const knownEdgeIds = useRef<Set<string>>(new Set());

  // Throttle bookkeeping for layout runs.
  const lastLayoutAt = useRef(0);
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep latest onSelect without re-binding cy handlers.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // ---- init / teardown -----------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    ensureFcose();

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      wheelSensitivity: 0.2,
      minZoom: 0.15,
      maxZoom: 3,
      style: buildStylesheet(),
    });
    cyRef.current = cy;

    // Click a node → select; click background → clear.
    cy.on("tap", "node", (evt) => {
      onSelectRef.current((evt.target as NodeSingular).id());
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) onSelectRef.current(null);
    });

    return () => {
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
      cy.destroy();
      cyRef.current = null;
      knownNodeIds.current.clear();
      knownEdgeIds.current.clear();
    };
  }, []);

  // ---- incremental append + animate ---------------------------------------
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const newNodes: ElementDefinition[] = [];
    for (const n of nodes) {
      if (knownNodeIds.current.has(n.id)) continue;
      knownNodeIds.current.add(n.id);
      // Seed position near a prerequisite already on screen so it "sprouts".
      const anchor = findAnchorPosition(cy, n.id, edges);
      newNodes.push({
        group: "nodes",
        data: { id: n.id, label: n.name },
        position: anchor,
        classes: "entering",
      });
    }

    // Add nodes FIRST so edge endpoints exist before we wire edges (otherwise a
    // static graph delivering nodes+edges in one render drops every edge).
    if (newNodes.length) cy.add(newNodes);

    const newEdges: ElementDefinition[] = [];
    for (const e of edges) {
      const id = edgeId(e);
      if (knownEdgeIds.current.has(id)) continue;
      // Endpoints must exist (guard against malformed edges).
      if (!cy.getElementById(e.from).nonempty()) continue;
      if (!cy.getElementById(e.to).nonempty()) continue;
      knownEdgeIds.current.add(id);
      newEdges.push({
        group: "edges",
        data: { id, source: e.from, target: e.to },
        classes: "entering",
      });
    }

    if (newNodes.length || newEdges.length) {
      if (newEdges.length) cy.add(newEdges);
      // Next frame: drop the `entering` class so style transitions animate in.
      const added = cy.collection();
      for (const def of newNodes) added.merge(cy.getElementById(def.data!.id!));
      for (const def of newEdges) added.merge(cy.getElementById(def.data!.id!));
      requestAnimationFrame(() => {
        added.removeClass("entering");
        // Brief "pop" glow on newly added nodes so growth reads as visceral.
        const addedNodes = added.nodes();
        addedNodes.addClass("justAdded");
        setTimeout(() => addedNodes.removeClass("justAdded"), 900);
      });
      scheduleLayout(cy);
    }

    // Always refresh derived state classes (known/current/next).
    applyStateClasses(cy, nodes, currentId, nextIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, currentId, nextIds]);

  // ---- selection styling ---------------------------------------------------
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("selected");
    if (selectedId) cy.getElementById(selectedId).addClass("selected");
  }, [selectedId]);

  // ---- status affordance (pulse while researching) ------------------------
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const container = cy.container();
    if (container) container.dataset.status = status;
  }, [status]);

  // ---- throttled layout ----------------------------------------------------
  function scheduleLayout(cy: Core) {
    const now = Date.now();
    const elapsed = now - lastLayoutAt.current;
    const run = () => {
      lastLayoutAt.current = Date.now();
      runLayout(cy);
    };
    if (elapsed >= LAYOUT_THROTTLE_MS) {
      run();
    } else if (!layoutTimer.current) {
      layoutTimer.current = setTimeout(() => {
        layoutTimer.current = null;
        run();
      }, LAYOUT_THROTTLE_MS - elapsed);
    }
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
      data-status={status}
      data-testid="graph-canvas"
    />
  );
}

// ---------------------------------------------------------------------------
// Layout: a layered, top-down hierarchy that reads the prerequisite DAG as a
// flow (prerequisites on top → dependents below). Far clearer than a force
// layout for small/medium graphs, and avoids the "scattered blobs" look.
function runLayout(cy: Core) {
  const animate = cy.nodes().length <= ANIMATE_NODE_LIMIT;
  cy.layout({
    name: "breadthfirst",
    directed: true,
    grid: false,
    animate,
    animationDuration: 450,
    fit: true,
    padding: 48,
    spacingFactor: 1.5,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: true,
    circle: false,
  } as cytoscape.LayoutOptions).run();

  // With only a handful of nodes, `fit` zooms in hard and the nodes balloon.
  // Cap the zoom so node size stays sensible, keeping the graph centred.
  if (cy.zoom() > 1.1) {
    const center = { x: cy.width() / 2, y: cy.height() / 2 };
    cy.zoom({ level: 1.1, renderedPosition: center });
    cy.center();
  }
}

// Seed a new node at a connected, already-placed node's position (+ jitter), so
// growth looks like sprouting from prerequisites rather than appearing at 0,0.
function findAnchorPosition(
  cy: Core,
  nodeId: string,
  edges: PrerequisiteEdge[],
): { x: number; y: number } {
  for (const e of edges) {
    const neighborId = e.from === nodeId ? e.to : e.to === nodeId ? e.from : null;
    if (!neighborId) continue;
    const neighbor = cy.getElementById(neighborId);
    if (neighbor.nonempty()) {
      const p = (neighbor as NodeSingular).position();
      return { x: p.x + (Math.random() - 0.5) * 80, y: p.y + (Math.random() - 0.5) * 80 };
    }
  }
  // No anchor yet: scatter near the viewport centre.
  const ext = cy.extent();
  const cx = (ext.x1 + ext.x2) / 2;
  const cy0 = (ext.y1 + ext.y2) / 2;
  return { x: cx + (Math.random() - 0.5) * 120, y: cy0 + (Math.random() - 0.5) * 120 };
}

// Toggle known/current/next classes from the latest concept data.
function applyStateClasses(
  cy: Core,
  nodes: Concept[],
  currentId: string | null,
  nextIds?: string[],
) {
  const nextSet = new Set(nextIds ?? []);
  cy.batch(() => {
    for (const n of nodes) {
      const ele = cy.getElementById(n.id);
      if (ele.empty()) continue;
      ele.toggleClass("known", n.known);
      ele.toggleClass("current", n.id === currentId);
      ele.toggleClass("next", nextSet.has(n.id));
    }
  });
}

// ---------------------------------------------------------------------------
// Stylesheet — the node-state legend lives here.
function buildStylesheet(): cytoscape.StylesheetStyle[] {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": 11,
        "font-weight": 600,
        color: "#1e293b",
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 5,
        "text-wrap": "wrap",
        "text-max-width": "120px",
        "text-background-color": "#f8fafc",
        "text-background-opacity": 0.85,
        "text-background-padding": "2px",
        "text-background-shape": "roundrectangle",
        "background-color": "#2bb7b3", // frontier (default teal)
        "border-width": 2,
        "border-color": "#1d8a87",
        width: 26,
        height: 26,
        // Smooth transitions power the grow-in + state changes.
        "transition-property":
          "opacity, width, height, background-color, border-color, border-width",
        "transition-duration": "0.4s" as unknown as number,
      },
    },
    {
      // Known concepts: pruned/dimmed.
      selector: "node.known",
      style: {
        "background-color": "#9aa6ad",
        "border-color": "#6f7b82",
        color: "#3a464d",
        opacity: 0.55,
      },
    },
    {
      // Current lecture target: bright highlight.
      selector: "node.current",
      style: {
        "background-color": "#ffd23f",
        "border-color": "#f59e0b",
        "border-width": 4,
        width: 34,
        height: 34,
        "z-index": 20,
      },
    },
    {
      // Upcoming lecture target.
      selector: "node.next",
      style: {
        "background-color": "#7ee0dd",
        "border-color": "#f59e0b",
        "border-width": 3,
      },
    },
    {
      // Click selection.
      selector: "node.selected",
      style: {
        "border-color": "#1d4ed8",
        "border-width": 5,
        "z-index": 30,
      },
    },
    {
      selector: "edge",
      style: {
        width: 2,
        "line-color": "#9fb6bf",
        "target-arrow-color": "#9fb6bf",
        "target-arrow-shape": "triangle", // prerequisite → dependent direction
        "curve-style": "bezier",
        "arrow-scale": 1.1,
        opacity: 0.85,
        "transition-property": "opacity, line-color, width",
        "transition-duration": "0.4s" as unknown as number,
      },
    },
    {
      // Hover highlight: emphasise the hovered node + its prerequisite chain.
      selector: ".highlight",
      style: {
        "line-color": "#1d4ed8",
        "target-arrow-color": "#1d4ed8",
        "border-color": "#1d4ed8",
        width: 3,
        opacity: 1,
        "z-index": 25,
      },
    },
    {
      selector: ".dimmed",
      style: { opacity: 0.15 },
    },
    {
      // Entering elements start invisible/small; removing the class animates in.
      selector: ".entering",
      style: { opacity: 0, width: 6, height: 6 },
    },
    {
      // Fresh-pop glow: a thick bright ring that fades as the class is removed.
      selector: "node.justAdded",
      style: {
        "border-width": 6,
        "border-color": "#ffd23f",
        "background-color": "#3fd0cc",
      },
    },
    {
      selector: "edge.entering",
      style: { opacity: 0, width: 0 },
    },
  ];
}

export const ENTER_DURATION_MS = ENTER_MS;
