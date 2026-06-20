/**
 * GET /api/research/stream?sessionId=…   (AC-7)
 *
 * EventSource-compatible (GET-only) Server-Sent Events endpoint that streams a
 * research session's `GraphEvent`s in real time. It first REPLAYS the graph
 * persisted so far (durable, resumable) and then TAILS live events from the bus
 * as the background worker discovers them — never batched at the end.
 *
 * A `:keep-alive` comment heartbeat is emitted every 20s (well under Azure's
 * idle cut and the SSE <60s requirement). The stream closes when a terminal
 * status (`converged`/`stopped`) is seen or the client disconnects.
 *
 * Wire format (per event):  data: <GraphEvent JSON>\n\n
 * Heartbeat:                 :keep-alive\n\n
 */

import type { NextRequest } from "next/server";
import type { GraphEvent } from "@/lib/ontology/types";
import { subscribe, cleanup, isDone } from "@/lib/research/bus";
import { replayEvents, loadGraph } from "@/lib/research/persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20_000;

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return new Response("missing sessionId", { status: 400 });
  }

  // Confirm the session exists (404 otherwise) before opening the stream.
  const graph = await loadGraph(sessionId);
  if (!graph) {
    return new Response("unknown sessionId", { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GraphEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          /* controller already closed */
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (unsubscribe) unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        cleanup(sessionId);
      };

      // 1) Replay everything persisted so far (durable snapshot).
      const replay = await replayEvents(sessionId);
      const snapshotTs = Date.now();
      for (const ev of replay) send(ev);

      // If the run already finished, replay was the whole story → close.
      if (isDone(sessionId) || (replay.at(-1)?.type === "status" &&
        replay.at(-1)?.payload !== "researching")) {
        close();
        return;
      }

      // 2) Tail live events; replay any buffered events newer than the snapshot.
      unsubscribe = subscribe(
        sessionId,
        (ev) => {
          send(ev);
          if (ev.type === "status" && ev.payload !== "researching") close();
        },
        snapshotTs,
      );

      // 3) Heartbeat so proxies/Azure never idle-cut the connection (<60s).
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`:keep-alive\n\n`));
        } catch {
          close();
        }
      }, HEARTBEAT_MS);

      // 4) Client disconnect → tear down.
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
      cleanup(sessionId);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
