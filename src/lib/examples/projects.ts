import type { Concept, PrerequisiteEdge } from "@/lib/ontology/types";

/**
 * Public example projects shown on the landing page to ANYONE (no login).
 * Each is a small, hand-curated prerequisite graph that demonstrates the
 * "topic → prerequisite map" idea without needing a live research run.
 */
export type ExampleProject = {
  id: string;
  title: string;
  topic: string;
  blurb: string;
  conceptCount: number;
  nodes: Concept[];
  edges: PrerequisiteEdge[];
};

function c(id: string, name: string, known = false): Concept {
  return { id, name, definition: "", summary: "", known };
}

export const EXAMPLE_PROJECTS: ExampleProject[] = [
  {
    id: "diffusion-models",
    title: "Diffusion Models",
    topic: "Diffusion models",
    blurb: "From probability and gradients up to denoising diffusion.",
    conceptCount: 6,
    nodes: [
      c("probability", "Probability"),
      c("gaussians", "Gaussians"),
      c("gradients", "Gradients"),
      c("neural-nets", "Neural networks"),
      c("markov-chains", "Markov chains"),
      c("ddpm", "Denoising diffusion (DDPM)"),
    ],
    edges: [
      { from: "probability", to: "gaussians" },
      { from: "probability", to: "markov-chains" },
      { from: "gradients", to: "neural-nets" },
      { from: "gaussians", to: "ddpm" },
      { from: "markov-chains", to: "ddpm" },
      { from: "neural-nets", to: "ddpm" },
    ],
  },
  {
    id: "kalman-filters",
    title: "Kalman Filters",
    topic: "Kalman filters",
    blurb: "Linear algebra and Bayesian updates to optimal state estimation.",
    conceptCount: 6,
    nodes: [
      c("linear-algebra", "Linear algebra"),
      c("probability", "Probability"),
      c("gaussians", "Gaussians"),
      c("state-space", "State-space models"),
      c("bayesian-update", "Bayesian update"),
      c("kalman", "Kalman filter"),
    ],
    edges: [
      { from: "linear-algebra", to: "state-space" },
      { from: "probability", to: "gaussians" },
      { from: "gaussians", to: "bayesian-update" },
      { from: "state-space", to: "kalman" },
      { from: "bayesian-update", to: "kalman" },
    ],
  },
  {
    id: "byzantine-consensus",
    title: "Byzantine Consensus",
    topic: "Byzantine consensus",
    blurb: "Distributed systems fundamentals up to BFT agreement.",
    conceptCount: 6,
    nodes: [
      c("processes-messages", "Processes & messages"),
      c("failure-models", "Failure models"),
      c("crash-consensus", "Crash consensus"),
      c("quorums", "Quorums"),
      c("byzantine-faults", "Byzantine faults"),
      c("pbft", "PBFT"),
    ],
    edges: [
      { from: "processes-messages", to: "failure-models" },
      { from: "failure-models", to: "crash-consensus" },
      { from: "failure-models", to: "byzantine-faults" },
      { from: "crash-consensus", to: "quorums" },
      { from: "quorums", to: "pbft" },
      { from: "byzantine-faults", to: "pbft" },
    ],
  },
  {
    id: "transformers",
    title: "Transformers",
    topic: "Transformer neural networks",
    blurb: "Linear algebra and attention up to the full transformer block.",
    conceptCount: 6,
    nodes: [
      c("linear-algebra", "Linear algebra"),
      c("softmax", "Softmax"),
      c("embeddings", "Embeddings"),
      c("attention", "Attention"),
      c("positional-encoding", "Positional encoding"),
      c("transformer-block", "Transformer block"),
    ],
    edges: [
      { from: "linear-algebra", to: "attention" },
      { from: "softmax", to: "attention" },
      { from: "embeddings", to: "attention" },
      { from: "attention", to: "transformer-block" },
      { from: "positional-encoding", to: "transformer-block" },
    ],
  },
];
