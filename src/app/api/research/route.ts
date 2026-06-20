/**
 * POST /api/research  (AC-1)
 *
 * Starts a research SESSION from a topic/prompt alone (no file upload). Creates
 * a Topic row, kicks off the BACKGROUND worker (never runs the multi-round loop
 * inside this handler — PRD §4.5), and returns immediately with a `sessionId`.
 * The client then opens `GET /api/research/stream?sessionId=…` to watch the
 * graph grow live.
 *
 * Request  (application/json): { topic: string, title?: string,
 *                                budget?: Partial<ResearchBudget>,
 *                                parallelAgents?: number }
 * Response (201): { sessionId: string, status: "researching" }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { startResearchWorker } from "@/lib/research/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  topic?: string;
  prompt?: string;
  title?: string;
  budget?: Record<string, number>;
  parallelAgents?: number;
  userId?: string;
};

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const topic = (body.topic ?? body.prompt ?? "").trim();
  if (!topic) {
    return NextResponse.json(
      { error: "`topic` (or `prompt`) is required" },
      { status: 400 },
    );
  }

  const userId = await getCurrentUserId(body.userId);
  const topicRow = await prisma.topic.create({
    data: {
      userId,
      title: (body.title ?? topic).slice(0, 200),
      prompt: topic,
      status: "researching",
    },
    select: { id: true },
  });

  // Fire-and-forget the background loop; returns before research completes.
  startResearchWorker({
    topicId: topicRow.id,
    topic,
    budget: body.budget,
    parallelAgents: body.parallelAgents,
  });

  return NextResponse.json(
    { sessionId: topicRow.id, status: "researching" },
    { status: 201 },
  );
}
