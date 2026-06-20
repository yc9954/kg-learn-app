/**
 * GET /api/health  — liveness probe (AC-13).
 *
 * Cheap, dependency-light: confirms the Node process + Next.js runtime are up.
 * Used by Azure App Service `healthCheckPath` and the CI smoke gate. It does NOT
 * spawn the Copilot runtime or hit the model — that is `/api/ai-health`.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "kg-learn",
    ts: new Date().toISOString(),
  });
}
