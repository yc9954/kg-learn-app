/**
 * GET /api/ai-health  — AI readiness + Azure-backend assertion probe (AC-13).
 *
 * This is the gate the CI/CD workflow hits AFTER deploy (and a release blocker,
 * like the forward-ref-0 test). It does the real thing:
 *   1. spawns the GitHub Copilot CLI runtime (via CopilotProvider),
 *   2. performs a trivial `generate()` round-trip through the BYOK provider,
 *   3. reports the RESOLVED model `base_url` so the caller can assert it is the
 *      Azure AI Foundry endpoint — and FAIL if it is a GitHub-hosted / non-Azure
 *      backend (PRD §4.2/§4.4).
 *
 * Response 200 only when: Foundry provider is configured AND the round-trip
 * succeeds AND the base_url is an Azure endpoint. Otherwise 503 with details.
 */
import { NextResponse } from "next/server";
import { CopilotProvider } from "@/lib/ai/copilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUND_TRIP_TIMEOUT_MS = 45_000;

/** True only for Azure AI Foundry / Azure OpenAI endpoints (never GitHub-hosted). */
function isAzureBackend(baseUrl: string | null): boolean {
  if (!baseUrl) return false;
  let host: string;
  try {
    host = new URL(baseUrl).host.toLowerCase();
  } catch {
    return false;
  }
  // Reject anything that is clearly a GitHub-hosted / non-Azure model gateway.
  if (host.includes("github") || host.includes("githubcopilot")) return false;
  return (
    host.endsWith(".openai.azure.com") ||
    host.endsWith(".cognitiveservices.azure.com") ||
    host.endsWith(".services.ai.azure.com") ||
    host.endsWith(".azure.com")
  );
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`ai-health round-trip timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export async function GET() {
  const baseUrl = CopilotProvider.foundryBaseUrl();
  const foundryConfigured = CopilotProvider.isFoundryConfigured();
  const model = process.env.FOUNDRY_DEPLOYMENT_NAME ?? null;
  const azureBacked = isAzureBackend(baseUrl);

  const base = {
    service: "kg-learn",
    foundryConfigured,
    base_url: baseUrl,
    model,
    azureBacked,
    ts: new Date().toISOString(),
  };

  // Fail fast if BYOK is not wired or the resolved backend is not Azure.
  if (!foundryConfigured || !azureBacked) {
    return NextResponse.json(
      {
        ...base,
        status: "error",
        error: !foundryConfigured
          ? "Azure AI Foundry BYOK provider is not configured."
          : "Resolved model base_url is not an Azure AI Foundry endpoint.",
      },
      { status: 503 },
    );
  }

  // Real round-trip: spawn the Copilot runtime and do a trivial generate().
  try {
    const reply = await withTimeout(
      CopilotProvider.generate("Reply with the single word: pong.", {
        tier: "quality",
        system: "You are a health probe. Answer in one word.",
      }),
      ROUND_TRIP_TIMEOUT_MS,
    );
    return NextResponse.json({
      ...base,
      status: "ok",
      roundTrip: "ok",
      sample: (reply ?? "").slice(0, 40),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ...base,
        status: "error",
        roundTrip: "failed",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}
