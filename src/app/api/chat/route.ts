/**
 * Chat API — a conversational agent surface for the learning app.
 *
 * POST /api/chat  (application/json)
 *   { messages: { role: "user"|"assistant"; content: string }[], topic?: string }
 *   → text/plain streaming response (the assistant's reply, token by token).
 *
 * The model is the same BYOK→Foundry Copilot provider the rest of the app uses.
 * An optional `topic` is woven into the system prompt so the agent stays grounded
 * in whatever knowledge graph the learner is currently exploring.
 */

import { type NextRequest } from "next/server";
import { CopilotProvider } from "@/lib/ai/copilot";
import { getCurrentUserId } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Body = { messages?: ChatMessage[]; topic?: string };

function systemPrompt(topic?: string): string {
  const base =
    "You are KG Learn's study assistant — a friendly, precise tutor. " +
    "Explain clearly, use short paragraphs, and prefer concrete examples. " +
    "When a concept has prerequisites, mention them so the learner can branch out. " +
    "Keep answers focused; use Markdown (and KaTeX $...$ for math) when helpful.";
  return topic
    ? `${base}\n\nThe learner is currently exploring the topic: "${topic}". Ground your answers in that context when relevant.`
    : base;
}

/** Flatten a short chat transcript into a single prompt for the provider. */
function renderTranscript(messages: ChatMessage[]): string {
  const recent = messages.slice(-12);
  return recent
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n")
    .concat("\n\nAssistant:");
}

export async function POST(request: NextRequest) {
  try {
    await getCurrentUserId();
  } catch {
    return new Response("authentication required", { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }

  const messages = (body.messages ?? []).filter(
    (m) => m && typeof m.content === "string" && m.content.trim().length > 0,
  );
  if (messages.length === 0) {
    return new Response("`messages` is required", { status: 400 });
  }

  const prompt = renderTranscript(messages);
  const system = systemPrompt(body.topic?.trim() || undefined);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamed = 0;
      try {
        const full = await CopilotProvider.stream(
          prompt,
          (chunk) => {
            streamed += chunk.length;
            controller.enqueue(encoder.encode(chunk));
          },
          { tier: "quality", system },
        );
        // Some providers/models don't emit deltas; flush the final content if
        // nothing was streamed incrementally so the reply is never empty.
        if (streamed === 0 && full) {
          controller.enqueue(encoder.encode(full));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "chat error";
        controller.enqueue(encoder.encode(`\n\n[error] ${msg}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
