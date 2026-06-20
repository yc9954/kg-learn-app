/**
 * Resolve the acting user for a request (AC-12 — per-user isolation).
 *
 * Order of resolution:
 *   1. The authenticated Auth.js (NextAuth) session — `session.user.id` is the
 *      LOCAL `User.id` stamped by the jwt/session callbacks in
 *      `src/lib/auth/options.ts`. Every Topic / UserProgress / AssessmentResult
 *      is keyed to it, so each user only ever sees their own graphs.
 *   2. An explicit `userId` (server-internal callers / tests) when it exists.
 *   3. DEV fallback: a stable per-process dev user — ONLY outside production, so
 *      the local pipeline stays exercisable without signing in. In production we
 *      THROW rather than silently share one anonymous user (multi-user safety).
 */
import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/db";

const DEV_USER_EMAIL = "dev@kg-learn.local";

/** Get the current user's id, preferring the signed-in Auth.js session. */
export async function getCurrentUserId(
  explicitUserId?: string,
): Promise<string> {
  // 1) Signed-in user (production multi-user path).
  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  if (sessionUserId) {
    const existing = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  // 2) Explicit id (internal callers / tests).
  if (explicitUserId) {
    const existing = await prisma.user.findUnique({
      where: { id: explicitUserId },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  // 3) Production requires authentication — never share one anonymous user.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Unauthorized: a signed-in user is required. Sign in via Entra ID.",
    );
  }

  // DEV fallback: stable local user so the pipeline runs without auth.
  const user = await prisma.user.upsert({
    where: { email: DEV_USER_EMAIL },
    create: { email: DEV_USER_EMAIL, name: "Dev User" },
    update: {},
    select: { id: true },
  });
  return user.id;
}
