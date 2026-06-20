/**
 * Lecture generator (PRD §8 step 5; AC-10/11). Generates ONE lecture at a time
 * for a single concept, using the GitHub Copilot SDK (tier "quality" — lecture
 * reasoning + prose quality matter) via `CopilotProvider.generate`. No other AI
 * SDK is imported (PRD §4.1).
 *
 * The forward-reference-0 keystone (PRD §6, AC-9) is upheld by constraining the
 * model to an ALLOW-LIST of concept names (known baseline ∪ already taught) and
 * an explicit FORBIDDEN list of not-yet-taught concept names, then enforced
 * structurally by gate.ts (which re-prompts with reinforced forbids on a miss).
 *
 * Output is Markdown that MAY embed ```mermaid fences and KaTeX ($…$ / $$…$$).
 */

import { CopilotProvider } from "@/lib/ai/copilot";
import type {
  Concept,
  DepthProfile,
  KnowledgeGraph,
} from "@/lib/ontology/types";

/** Model-call shim so generation is unit-testable offline with a mock. */
export type GenerateFn = (
  prompt: string,
  opts?: { tier?: "quality" | "fast"; system?: string },
) => Promise<string>;

const defaultGenerate: GenerateFn = (prompt, opts) =>
  CopilotProvider.generate(prompt, opts);

/** Everything needed to write one forward-ref-safe lecture. */
export type LectureContext = {
  /** The concept this lecture teaches. */
  concept: Concept;
  /** The full knowledge graph (for names/definitions of allowed concepts). */
  graph: KnowledgeGraph;
  /** Depth/verbosity derived from the learner's assessed level. */
  depthProfile: DepthProfile;
  /** Concept ids the learner may rely on = known baseline ∪ already taught. */
  allowedConceptIds: string[];
  /** 0-based position of this lecture in the pruned learning path. */
  order: number;
};

const LECTURE_SYSTEM = `You are an expert tutor writing ONE focused micro-lecture
on a SINGLE concept, as part of a course built on a prerequisite knowledge graph.

The ONE inviolable rule (forward-reference 0): you may use, name, or rely on ONLY
the concepts in the ALLOWED list (things the learner has already been taught or
already knows) plus the concept being taught. You MUST NOT mention, name, or
assume any concept in the FORBIDDEN list — those have not been taught yet.
Everything else is unconstrained: you may use ordinary, plain-English background
vocabulary freely, but never the NAME of a forbidden graph concept.

Output format:
- GitHub-flavored Markdown for ONE concept only. Be focused; brevity beats sprawl.
- Open with an H2 heading naming the concept.
- You MAY include exactly one Mermaid diagram in a \`\`\`mermaid fenced block when
  it genuinely aids understanding.
- You MAY include math with KaTeX: inline as $...$ and display as $$...$$.
- Do NOT include a "prerequisites" or "next up" section that names other concepts.
- Never define a forbidden concept "for later". If you feel you need one, you do
  not — re-explain using only allowed concepts and plain language.`;

/** A concept reference line: "Name — one-line summary" for prompt context. */
function conceptLine(c: Concept): string {
  const gloss = (c.summary || c.definition || "").trim();
  return gloss ? `- ${c.name} — ${gloss}` : `- ${c.name}`;
}

function depthGuidance(d: DepthProfile): string {
  const verbosity =
    d.verbosity === "deep"
      ? "Explain thoroughly from first principles; define jargon before use."
      : d.verbosity === "terse"
        ? "Be terse and dense; assume a capable reader and skip basic motivation."
        : "Balanced depth; motivate briefly, then explain clearly.";
  const examples =
    d.exampleDensity === "high"
      ? "Include 2+ concrete worked examples."
      : d.exampleDensity === "low"
        ? "Include at most one short example, only if it clarifies."
        : "Include one illustrative example.";
  return `${verbosity} ${examples} Assumed background: ${d.assumedBackground}`;
}

/**
 * Build the generation prompt for a concept. `extraForbidden` reinforces the
 * forbidden list with offender NAMES discovered by a prior gate failure so the
 * regenerated lecture stops naming them (used by gate.ts on retry).
 */
export function buildLecturePrompt(
  ctx: LectureContext,
  extraForbidden: string[] = [],
): string {
  const allowedSet = new Set(ctx.allowedConceptIds);
  const allowed = ctx.graph.nodes.filter((n) => allowedSet.has(n.id));
  const forbidden = ctx.graph.nodes.filter(
    (n) => !allowedSet.has(n.id) && n.id !== ctx.concept.id,
  );

  const allowedBlock =
    allowed.length > 0
      ? allowed.map(conceptLine).join("\n")
      : "(none — this is a foundational concept; rely only on plain language)";

  const forbiddenNames = [
    ...forbidden.map((n) => n.name),
    ...extraForbidden,
  ];
  const forbiddenBlock =
    forbiddenNames.length > 0
      ? forbiddenNames.map((n) => `- ${n}`).join("\n")
      : "(none)";

  return `CONCEPT TO TEACH: ${ctx.concept.name}
DEFINITION: ${ctx.concept.definition}
SUMMARY: ${ctx.concept.summary}

ALLOWED CONCEPTS (already taught or known — safe to use and name):
${allowedBlock}

FORBIDDEN CONCEPTS (NOT yet taught — you must NOT name or rely on any of these):
${forbiddenBlock}

DEPTH: ${depthGuidance(ctx.depthProfile)}

Write the micro-lecture for "${ctx.concept.name}" now, in Markdown, obeying the
forward-reference-0 rule above. Teach ONLY this one concept.`;
}

/**
 * Produce raw lecture Markdown for a concept (no gating here — gate.ts wraps
 * this with the forward-ref-0 enforcement loop). `extraForbidden` lets the gate
 * reinforce the forbidden list on regeneration.
 */
export async function generateLectureMarkdown(
  ctx: LectureContext,
  generate: GenerateFn = defaultGenerate,
  extraForbidden: string[] = [],
): Promise<string> {
  const md = await generate(buildLecturePrompt(ctx, extraForbidden), {
    tier: "quality",
    system: LECTURE_SYSTEM,
  });
  return (md ?? "").trim();
}
