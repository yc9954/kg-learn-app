/**
 * Lectures library API — every lecture the signed-in user has generated.
 *
 *   GET /api/lectures → { topics: LectureTopic[] }
 *
 * Lectures belong to Topics, which belong to the user (AC-12). This returns only
 * the user's own topics that have at least one generated lecture, each with its
 * lectures in topological (`order`) sequence so the Lectures tab can render the
 * learner's produced course as read-only notes.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type LectureItem = {
  conceptId: string;
  title: string;
  order: number;
  markdown: string;
};

export type LectureTopic = {
  id: string;
  title: string;
  prompt: string;
  updatedAt: string;
  lectures: LectureItem[];
};

export async function GET() {
  const userId = await getCurrentUserId();

  const topics = await prisma.topic.findMany({
    where: { userId, lectures: { some: {} } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      prompt: true,
      updatedAt: true,
      lectures: {
        orderBy: { order: "asc" },
        select: {
          conceptId: true,
          order: true,
          markdown: true,
          concept: { select: { name: true } },
        },
      },
    },
  });

  const result: LectureTopic[] = topics.map((t) => ({
    id: t.id,
    title: t.title,
    prompt: t.prompt,
    updatedAt: t.updatedAt.toISOString(),
    lectures: t.lectures.map((l) => ({
      conceptId: l.conceptId,
      title: l.concept?.name ?? "Lecture",
      order: l.order,
      markdown: l.markdown,
    })),
  }));

  return NextResponse.json({ topics: result });
}
