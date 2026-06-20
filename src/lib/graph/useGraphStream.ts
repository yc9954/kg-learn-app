"use client";

/**
 * useGraphStream — opens an EventSource on the research-engine SSE endpoint and
 * reduces incoming `GraphEvent`s into live graph state (PRD §8 step 4; AC-7).
 *
 * Contract (as produced by research-engine):
 *   - `POST /api/research` (done elsewhere) returns `{ sessionId }`.
 *   - `GET /api/research/stream?sessionId=…` is an EventSource-compatible,
 *     GET-only SSE stream: it REPLAYS the persisted graph first, then TAILS live
 *     events, with a `:keep-alive` heartbeat (~20s). Wire format is
 *     `data: <GraphEvent JSON>\n\n`.
 *
 * EventSource is GET-only and auto-reconnects on drop; because the server
 * replays the durable snapshot on every (re)connect and our reducer is
 * idempotent (upsert by id / dedupe edges), a reconnect reconciles for free —
 * no manual resync needed (graceful SSE-drop degradation).
 *
 * We close the stream ourselves once a terminal status (`converged`/`stopped`)
 * arrives, so the browser does not keep reconnecting to a finished session.
 */

import { useEffect, useReducer, useRef, useState } from "react";
import type { GraphEvent } from "@/lib/ontology/types";
import {
  initialGraphStreamState,
  isTerminalStatus,
  reduceGraphEvent,
  stateFromGraph,
  type GraphStreamState,
} from "./reducer";
import type { KnowledgeGraph } from "@/lib/ontology/types";

type Action =
  | { kind: "reset" }
  | { kind: "seed"; graph: KnowledgeGraph }
  | { kind: "event"; event: GraphEvent };

function reducer(state: GraphStreamState, action: Action): GraphStreamState {
  switch (action.kind) {
    case "reset":
      return initialGraphStreamState;
    case "seed":
      return stateFromGraph(action.graph);
    case "event":
      return reduceGraphEvent(state, action.event);
  }
}

export type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

export type UseGraphStreamResult = GraphStreamState & {
  connection: ConnectionState;
};

/**
 * Stream a research session's graph live.
 *
 * @param sessionId  The id from `POST /api/research`. Pass `null`/`undefined`
 *                   to stay idle (no connection). Changing it tears down the old
 *                   stream and starts fresh.
 * @param staticGraph Optional pre-loaded graph to render when there is no live
 *                   session (e.g. a persisted, already-converged topic).
 */
export function useGraphStream(
  sessionId: string | null | undefined,
  staticGraph?: KnowledgeGraph,
): UseGraphStreamResult {
  const [state, dispatch] = useReducer(reducer, initialGraphStreamState);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const doneRef = useRef(false);

  // Render a static graph when no live session is attached.
  useEffect(() => {
    if (sessionId) return;
    if (staticGraph) dispatch({ kind: "seed", graph: staticGraph });
    else dispatch({ kind: "reset" });
    setConnection("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, staticGraph]);

  useEffect(() => {
    if (!sessionId) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    dispatch({ kind: "reset" });
    doneRef.current = false;
    setConnection("connecting");

    const url = `/api/research/stream?sessionId=${encodeURIComponent(sessionId)}`;
    const es = new EventSource(url);

    es.onopen = () => {
      if (!doneRef.current) setConnection("open");
    };

    es.onmessage = (msg: MessageEvent<string>) => {
      if (!msg.data) return;
      let event: GraphEvent;
      try {
        event = JSON.parse(msg.data) as GraphEvent;
      } catch {
        return; // ignore malformed frames (heartbeats never reach here)
      }
      dispatch({ kind: "event", event });

      if (event.type === "status" && isTerminalStatus(event.payload)) {
        // Run finished: stop the browser from auto-reconnecting.
        doneRef.current = true;
        setConnection("closed");
        es.close();
      }
    };

    es.onerror = () => {
      if (doneRef.current) return;
      // EventSource reconnects on its own; the server replays the snapshot, so
      // the reducer reconciles. Reflect the transient state in the UI.
      setConnection(
        es.readyState === EventSource.CLOSED ? "closed" : "reconnecting",
      );
    };

    return () => {
      doneRef.current = true;
      es.close();
    };
  }, [sessionId]);

  return { ...state, connection };
}
