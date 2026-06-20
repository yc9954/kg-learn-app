/**
 * Shared domain ontology — THE single source of truth for the entire
 * `kg-learn-*` agent suite (PRD §7). Every module imports from this file.
 * Never fork these types; if the contract must change, update the PRD first,
 * then this file, then all importers.
 */

/** A single node in the prerequisite knowledge graph. */
export type Concept = {
  id: string;
  name: string;
  definition: string;
  summary: string;
  /** True once the learner is known (via assessment) to already understand it. */
  known: boolean;
};

/**
 * A directed prerequisite relationship.
 * `from` is a prerequisite OF `to` (you must learn `from` before `to`).
 * The graph MUST remain a DAG (see invariants.ts:wouldCreateCycle).
 */
export type PrerequisiteEdge = { from: string; to: string };

/** Lifecycle of a research/graph build. */
export type GraphStatus = "idle" | "researching" | "converged" | "stopped";

/** The full knowledge graph for one topic. */
export type KnowledgeGraph = {
  topicId: string;
  nodes: Concept[];
  edges: PrerequisiteEdge[];
  status: GraphStatus;
};

/** A live event streamed (SSE) from the server to the client as the graph grows. */
export type GraphEvent =
  | { type: "node"; payload: Concept; ts: number }
  | { type: "edge"; payload: PrerequisiteEdge; ts: number }
  | { type: "status"; payload: GraphStatus; ts: number };

/** One question in the upfront adaptive level assessment. */
export type AssessmentQuestion = {
  id: string;
  text: string;
  options: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
};

/** How deep/verbose lectures should be, derived from the assessment. */
export type DepthProfile = {
  assumedBackground: string;
  verbosity: "terse" | "normal" | "deep";
  exampleDensity: "low" | "medium" | "high";
};

/** The learner's assessed level + the concepts they already know. */
export type UserLevel = {
  level: "beginner" | "intermediate" | "advanced";
  knownConceptIds: string[];
  depthProfile: DepthProfile;
};

/** A generated lecture for a single concept. Markdown may embed Mermaid + KaTeX. */
export type Lecture = {
  id: string;
  conceptId: string;
  order: number;
  markdown: string;
};

/** The topologically-ordered sequence of lectures for a topic. */
export type LearningPath = { topicId: string; orderedLectureIds: string[] };

/** Per-user progress through a topic's learning path. */
export type UserProgress = {
  userId: string;
  topicId: string;
  completedLectureIds: string[];
  currentNodeId: string | null;
};

/** A web/scholarly source surfaced during research. */
export type WebSource = { url: string; title: string; snippet: string };
