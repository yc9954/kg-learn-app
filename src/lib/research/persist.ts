/**
 * DB persistence for research output (PRD §5, AC-12). Concepts/edges are written
 * to Prisma as they arrive so the SSE endpoint can REPLAY a session's graph from
 * durable storage and then tail live events — making research resumable and
 * decoupled from any single HTTP request.
 *
 * Domain ↔ DB mapping:
 *   - Concept.id (ontology/domain) ⇒ Concept.conceptKey (DB), unique per topic.
 *   - PrerequisiteEdge.from/to (domain conceptKeys) ⇒ Edge.fromId/toId (DB row ids).
 */

import "server-only";
import { prisma } from "@/lib/db";
import type {
  Concept,
  GraphEvent,
  GraphStatus,
  KnowledgeGraph,
  PrerequisiteEdge,
} from "@/lib/ontology/types";

/** Upsert a concept (idempotent by topicId + conceptKey). */
export async function persistConcept(
  topicId: string,
  concept: Concept,
): Promise<void> {
  await prisma.concept.upsert({
    where: { topicId_conceptKey: { topicId, conceptKey: concept.id } },
    create: {
      topicId,
      conceptKey: concept.id,
      name: concept.name,
      definition: concept.definition,
      summary: concept.summary,
      known: concept.known,
    },
    update: {
      name: concept.name,
      definition: concept.definition,
      summary: concept.summary,
    },
  });
}

/** Persist an edge by resolving domain conceptKeys → DB Concept row ids. */
export async function persistEdge(
  topicId: string,
  edge: PrerequisiteEdge,
): Promise<void> {
  const [from, to] = await Promise.all([
    prisma.concept.findUnique({
      where: { topicId_conceptKey: { topicId, conceptKey: edge.from } },
      select: { id: true },
    }),
    prisma.concept.findUnique({
      where: { topicId_conceptKey: { topicId, conceptKey: edge.to } },
      select: { id: true },
    }),
  ]);
  if (!from || !to) return; // dangling — skip silently (orchestrator guards too)
  await prisma.edge.upsert({
    where: {
      topicId_fromId_toId: { topicId, fromId: from.id, toId: to.id },
    },
    create: { topicId, fromId: from.id, toId: to.id },
    update: {},
  });
}

/** Update the topic's GraphStatus. */
export async function persistStatus(
  topicId: string,
  status: GraphStatus,
): Promise<void> {
  await prisma.topic.update({ where: { id: topicId }, data: { status } });
}

/** Persist a single GraphEvent (used by the worker's onEvent sink). */
export async function persistEvent(
  topicId: string,
  event: GraphEvent,
): Promise<void> {
  if (event.type === "node") return persistConcept(topicId, event.payload);
  if (event.type === "edge") return persistEdge(topicId, event.payload);
  return persistStatus(topicId, event.payload);
}

/** Load the full persisted graph for a topic from the DB. */
export async function loadGraph(topicId: string): Promise<KnowledgeGraph | null> {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: {
      id: true,
      status: true,
      concepts: {
        select: {
          id: true,
          conceptKey: true,
          name: true,
          definition: true,
          summary: true,
          known: true,
        },
      },
      edges: { select: { fromId: true, toId: true } },
    },
  });
  if (!topic) return null;

  const keyByRowId = new Map(topic.concepts.map((c) => [c.id, c.conceptKey]));
  return {
    topicId: topic.id,
    status: topic.status as GraphStatus,
    nodes: topic.concepts.map((c) => ({
      id: c.conceptKey,
      name: c.name,
      definition: c.definition,
      summary: c.summary,
      known: c.known,
    })),
    edges: topic.edges
      .map((e) => ({
        from: keyByRowId.get(e.fromId),
        to: keyByRowId.get(e.toId),
      }))
      .filter((e): e is PrerequisiteEdge => !!e.from && !!e.to),
  };
}

/**
 * Build the ordered GraphEvents that replay a persisted graph: every node, then
 * every edge, then the current status. The SSE endpoint sends these first, then
 * tails live events from the bus.
 */
export async function replayEvents(topicId: string): Promise<GraphEvent[]> {
  const graph = await loadGraph(topicId);
  if (!graph) return [];
  const ts = Date.now();
  const events: GraphEvent[] = [];
  for (const node of graph.nodes) events.push({ type: "node", payload: node, ts });
  for (const edge of graph.edges) events.push({ type: "edge", payload: edge, ts });
  events.push({ type: "status", payload: graph.status, ts });
  return events;
}
