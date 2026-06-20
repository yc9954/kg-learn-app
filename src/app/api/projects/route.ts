/**
 * Projects API — the signed-in user's own research projects (their Topics).
 *
 *   GET    /api/projects            → { projects: ProjectSummary[] }
 *   DELETE /api/projects?id=<topic> → { ok: true }
 *
 * Every project is scoped to the acting user (AC-12), so a learner only ever
 * sees and mutates their own topics. Opening a project elsewhere replays its
 * persisted graph over the existing SSE stream (GET /api/research/stream).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function lenOf(json: unknown): number {
  return Array.isArray(json) ? json.length : 0;
}

export async function GET() {
  const userId = await getCurrentUserId();

  const topics = await prisma.topic.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      prompt: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { concepts: true, edges: true, lectures: true } },
      progress: { where: { userId }, select: { completed: true } },
    },
  });

  const projects = topics.map((t) => {
    const mastered = t.progress.reduce((s, p) => s + lenOf(p.completed), 0);
    return {
      id: t.id,
      title: t.title,
      prompt: t.prompt,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      concepts: t._count.concepts,
      edges: t._count.edges,
      lectures: t._count.lectures,
      mastered,
    };
  });

  return NextResponse.json({ projects });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing `id`" }, { status: 400 });
  }

  const userId = await getCurrentUserId();
  // Only delete a topic the caller owns (cascade clears concepts/edges/etc.).
  const result = await prisma.topic.deleteMany({ where: { id, userId } });
  if (result.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
