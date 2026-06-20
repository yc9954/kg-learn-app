import type { Concept, PrerequisiteEdge } from "@/lib/ontology/types";

/**
 * Public example projects shown on the landing page to ANYONE (no login).
 * Each is a small, hand-curated prerequisite graph that demonstrates the
 * "topic → prerequisite map" idea without needing a live research run.
 */
export type ExampleNote = {
  conceptId: string;
  title: string;
  markdown: string;
};

export type ExampleProject = {
  id: string;
  title: string;
  topic: string;
  blurb: string;
  conceptCount: number;
  nodes: Concept[];
  edges: PrerequisiteEdge[];
  notes: ExampleNote[];
};

function c(id: string, name: string, known = false): Concept {
  return { id, name, definition: "", summary: "", known };
}

function note(conceptId: string, title: string, markdown: string): ExampleNote {
  return { conceptId, title, markdown };
}

/**
 * Turn the rich note markdown into a short, plain-text first sentence so a
 * clicked node can show a concise definition (the full markdown becomes the
 * node summary, rendered with LaTeX in the detail panel).
 */
function firstSentence(markdown: string): string {
  const plain = markdown
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = plain.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : plain).trim();
}

/**
 * Backfill each node's `definition` + `summary` from its matching lecture note
 * so clicking a node in an example graph opens a real, detailed description.
 */
function withNodeDetails(p: ExampleProject): ExampleProject {
  const byId = new Map(p.notes.map((n) => [n.conceptId, n]));
  return {
    ...p,
    nodes: p.nodes.map((n) => {
      const note = byId.get(n.id);
      if (!note) return n;
      return {
        ...n,
        definition: n.definition || firstSentence(note.markdown),
        summary: n.summary || note.markdown,
      };
    }),
  };
}

const RAW_PROJECTS: ExampleProject[] = [
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
    notes: [
      note(
        "probability",
        "Probability",
        "Diffusion models are fundamentally probabilistic: they learn a **distribution** over data. You need random variables, expectation, and conditional probability $p(x\\mid z)$ as the language for everything that follows.",
      ),
      note(
        "gaussians",
        "Gaussians",
        "The **normal distribution** $\\mathcal{N}(\\mu,\\sigma^2)$ is the noise of choice. The forward process adds Gaussian noise step by step, and its closed-form properties (sums of Gaussians are Gaussian) make the math tractable.",
      ),
      note(
        "gradients",
        "Gradients",
        "Training minimises a loss via **gradient descent**. A gradient $\\nabla_\\theta L$ points uphill; we step the other way. This is the engine that fits the denoiser.",
      ),
      note(
        "neural-nets",
        "Neural networks",
        "A neural network is a stack of learnable linear maps + nonlinearities. In diffusion, a U-Net plays the **denoiser** $\\epsilon_\\theta(x_t,t)$ that predicts the noise added at step $t$.",
      ),
      note(
        "markov-chains",
        "Markov chains",
        "The forward (noising) process is a **Markov chain**: each state depends only on the previous one. This lets us write the joint as a product of simple transitions $q(x_t\\mid x_{t-1})$.",
      ),
      note(
        "ddpm",
        "Denoising diffusion (DDPM)",
        "Putting it together: noise data over $T$ steps, then train a network to **reverse** each step. Sampling starts from pure noise and denoises down to a clean sample. Loss reduces to predicting the added noise.",
      ),
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
    notes: [
      note(
        "linear-algebra",
        "Linear algebra",
        "Kalman filters live in **vectors and matrices**. State is a vector $x$, dynamics a matrix $F$, and the algebra of $Fx$, transposes, and inverses is used at every step.",
      ),
      note(
        "probability",
        "Probability",
        "Estimates carry **uncertainty**. We track not just a best guess but a distribution, so probability and covariance are first-class citizens.",
      ),
      note(
        "gaussians",
        "Gaussians",
        "The filter assumes **Gaussian** state and noise, summarised by a mean and covariance matrix $P$. Gaussians stay Gaussian under linear maps — the key that makes Kalman exact.",
      ),
      note(
        "state-space",
        "State-space models",
        "A **state-space model** describes a system as a hidden state evolving over time ($x_{t}=Fx_{t-1}+w$) plus noisy measurements ($z_t=Hx_t+v$). This is the world the filter operates in.",
      ),
      note(
        "bayesian-update",
        "Bayesian update",
        "Each measurement refines belief via **Bayes' rule**: prior × likelihood → posterior. The Kalman gain decides how much to trust the new measurement vs. the prediction.",
      ),
      note(
        "kalman",
        "Kalman filter",
        "The filter alternates **predict** (push state forward, grow uncertainty) and **update** (fold in a measurement, shrink uncertainty). It is the optimal estimator for linear-Gaussian systems.",
      ),
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
    notes: [
      note(
        "processes-messages",
        "Processes & messages",
        "A distributed system is **processes** exchanging **messages** over an unreliable network. No shared clock, variable delays — the setting that makes agreement hard.",
      ),
      note(
        "failure-models",
        "Failure models",
        "We classify how nodes break: **crash** (stop silently), **omission** (drop messages), or **Byzantine** (arbitrary/malicious). The model dictates which algorithms are possible.",
      ),
      note(
        "crash-consensus",
        "Crash consensus",
        "With only crash faults, protocols like Paxos/Raft reach agreement. They tolerate $f$ failures with $2f+1$ nodes — a useful baseline before adversaries enter.",
      ),
      note(
        "quorums",
        "Quorums",
        "A **quorum** is any majority that must intersect every other quorum. Intersection guarantees that committed decisions are seen by future leaders — the safety backbone.",
      ),
      note(
        "byzantine-faults",
        "Byzantine faults",
        "**Byzantine** nodes can lie, equivocate, or collude. Defending against them needs cryptographic checks and larger quorums — you can't trust a single message.",
      ),
      note(
        "pbft",
        "PBFT",
        "**Practical Byzantine Fault Tolerance** reaches agreement with $3f+1$ nodes despite $f$ Byzantine ones, using a three-phase (pre-prepare/prepare/commit) protocol over intersecting quorums.",
      ),
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
    notes: [
      note(
        "linear-algebra",
        "Linear algebra",
        "Transformers are **matrix multiplications** end to end. Queries, keys, and values are linear projections $XW_Q, XW_K, XW_V$ — comfort with matrix products is essential.",
      ),
      note(
        "softmax",
        "Softmax",
        "**Softmax** turns scores into a probability distribution: $\\text{softmax}(z)_i = e^{z_i}/\\sum_j e^{z_j}$. It's how attention weights are normalised to sum to one.",
      ),
      note(
        "embeddings",
        "Embeddings",
        "Tokens become vectors via an **embedding** table. Similar tokens sit near each other, giving the model a continuous space to compute over.",
      ),
      note(
        "attention",
        "Attention",
        "**Scaled dot-product attention** mixes information: $\\text{Attn}(Q,K,V)=\\text{softmax}(QK^\\top/\\sqrt{d})V$. Each token attends to others, weighted by relevance.",
      ),
      note(
        "positional-encoding",
        "Positional encoding",
        "Attention is order-agnostic, so we inject **position** information (sinusoidal or learned) into embeddings, letting the model know token order.",
      ),
      note(
        "transformer-block",
        "Transformer block",
        "A **block** stacks multi-head attention + a feed-forward network, each wrapped in residual connections and layer norm. Stack many blocks and you have a transformer.",
      ),
    ],
  },
];

/** Public projects with each node's definition/summary backfilled from its note. */
export const EXAMPLE_PROJECTS: ExampleProject[] = RAW_PROJECTS.map(withNodeDetails);
