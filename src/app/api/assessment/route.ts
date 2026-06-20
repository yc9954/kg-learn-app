/**
 * Assessment API (PRD §8 step 3, AC-4/5).
 *
 * Upfront ADAPTIVE quiz served one question at a time, then scored + applied to
 * the topic graph. The flow never blocks the live graph from rendering — it
 * reads the already-persisted graph and can run in parallel with / right after
 * research convergence.
 *
 * ── Contract ──────────────────────────────────────────────────────────────
 * GET  /api/assessment?topicId=…[&userId=…]
 *      → 200 { userLevel: UserLevel | null }      (resume a prior result)
 *
 * POST /api/assessment   (application/json), discriminated by `action`:
 *  { action:"start",  topicId[, userId] }
 *      → 200 { done:false, question: AssessmentQuestion } | { done:true, question:null }
 *  { action:"answer", topicId, questionId, answer:(string|number)[, userId] }
 *      → 200 { done:false, question: AssessmentQuestion } | { done:true, question:null }
 *  { action:"submit", topicId[, userId] }
 *      → 200 { userLevel: UserLevel, knownBaseline: string[] }   (scores + applies + persists)
 *
 * The wire `AssessmentQuestion` carries NO answer key; correctness is resolved
 * server-side from the in-progress session held in @/lib/assessment.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { loadGraph } from "@/lib/research/persist";
import {
  startAssessment,
  answerAndNext,
  finalizeAssessment,
  applyUserLevel,
  clearAssessmentSession,
  type Answer,
} from "@/lib/assessment";
import {
  saveAssessmentResult,
  persistKnownFlags,
  loadAssessmentResult,
} from "@/lib/assessment/persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  action?: "start" | "answer" | "submit";
  topicId?: string;
  questionId?: string;
  answer?: Answer;
  userId?: string;
};

async function topicTitle(topicId: string): Promise<string> {
  const t = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { title: true, prompt: true },
  });
  return t?.title || t?.prompt || topicId;
}

export async function GET(request: NextRequest) {
  const topicId = request.nextUrl.searchParams.get("topicId") ?? "";
  if (!topicId) {
    return NextResponse.json({ error: "`topicId` is required" }, { status: 400 });
  }
  const userId = await getCurrentUserId(
    request.nextUrl.searchParams.get("userId") ?? undefined,
  );
  const userLevel = await loadAssessmentResult(userId, topicId);
  return NextResponse.json({ userLevel });
}

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const topicId = (body.topicId ?? "").trim();
  if (!topicId) {
    return NextResponse.json({ error: "`topicId` is required" }, { status: 400 });
  }

  const graph = await loadGraph(topicId);
  if (!graph) {
    return NextResponse.json({ error: "unknown topicId" }, { status: 404 });
  }
  if (graph.nodes.length === 0) {
    return NextResponse.json(
      { error: "graph has no concepts yet; wait for research to produce nodes" },
      { status: 409 },
    );
  }

  const userId = await getCurrentUserId(body.userId);
  const title = await topicTitle(topicId);

  try {
    switch (body.action) {
      case "start": {
        const result = await startAssessment(graph, title);
        return NextResponse.json(result);
      }

      case "answer": {
        const questionId = (body.questionId ?? "").trim();
        if (!questionId || body.answer === undefined) {
          return NextResponse.json(
            { error: "`questionId` and `answer` are required" },
            { status: 400 },
          );
        }
        const result = await answerAndNext(graph, title, questionId, body.answer);
        return NextResponse.json(result);
      }

      case "submit": {
        const userLevel = finalizeAssessment(graph);
        const { knownBaseline } = applyUserLevel(graph, userLevel);
        // Durable: flip known flags + store the per-user result.
        await persistKnownFlags(topicId, knownBaseline);
        await saveAssessmentResult(userId, topicId, userLevel, {
          knownConceptIds: userLevel.knownConceptIds,
        });
        clearAssessmentSession(topicId);
        return NextResponse.json({ userLevel, knownBaseline });
      }

      default:
        return NextResponse.json(
          { error: "`action` must be one of: start, answer, submit" },
          { status: 400 },
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "assessment error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
