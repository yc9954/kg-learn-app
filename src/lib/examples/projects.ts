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
  /** A completed research report for the whole topic (rich markdown). */
  report: string;
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
    report: `## Research report — Diffusion models

**Goal.** Understand how denoising diffusion probabilistic models (DDPMs) generate images, audio, and other high-dimensional data by *learning to reverse a gradual noising process*.

### Why it matters
Diffusion models are the engine behind modern image generators (Stable Diffusion, DALL·E 2/3, Imagen). They produce sharp, diverse samples and train more stably than GANs because the learning target — predicting the noise added at a known step — is a simple regression problem rather than an adversarial game.

### The big idea
1. **Forward process** — take a clean sample $x_0$ and add a little Gaussian noise repeatedly for $T$ steps until $x_T$ is indistinguishable from pure noise $\\mathcal{N}(0, I)$.
2. **Reverse process** — train a neural network $\\epsilon_\\theta(x_t, t)$ to predict the noise that was added at each step, so we can *undo* it.
3. **Sampling** — start from random noise and apply the learned denoiser step by step until a clean sample emerges.

### Prerequisite structure
The graph below is the minimal dependency chain. **Probability** gives the language of distributions; **Gaussians** are the specific noise used and keep the math closed-form; **Markov chains** formalise the step-by-step process; **Gradients** and **Neural networks** provide the trainable denoiser. Everything converges on **DDPM**.

\`\`\`mermaid
graph LR
  P[Probability] --> G[Gaussians]
  P --> M[Markov chains]
  Gr[Gradients] --> N[Neural networks]
  G --> D[DDPM]
  M --> D
  N --> D
\`\`\`

### Key result
The training loss simplifies to a single, beautiful objective:
$$\\mathcal{L} = \\mathbb{E}_{t, x_0, \\epsilon}\\big[\\, \\lVert \\epsilon - \\epsilon_\\theta(x_t, t) \\rVert^2 \\,\\big]$$
i.e. *predict the noise*. That is the whole training signal.

### What to learn next
Score-based models (the continuous-time view via SDEs), classifier-free guidance (how text prompts steer sampling), and latent diffusion (running the process in a compressed latent space for speed).`,
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
        `Diffusion models are fundamentally probabilistic: they learn a **distribution** over data rather than a single answer. Before anything else, we need the vocabulary of randomness.

**Core objects.** A *random variable* $X$ takes values with certain probabilities. Its *expectation* $\\mathbb{E}[X]$ is the long-run average, and *conditional probability* $p(x \\mid z)$ describes how likely $x$ is once we know $z$.

**Why it shows up here.** The forward noising process is written as a conditional $q(x_t \\mid x_{t-1})$, and the model we train approximates the reverse conditional $p_\\theta(x_{t-1} \\mid x_t)$. The whole method is a story about transforming one distribution (data) into another (noise) and back.

**Worked intuition.** If $X$ is a fair die, $\\mathbb{E}[X] = 3.5$. Conditioning changes beliefs: $p(X = 6 \\mid X \\text{ is even}) = 1/3$. Diffusion does the same conditioning, just over images instead of dice.

*Feeds forward:* this language lets us define Gaussians and Markov chains precisely.`,
      ),
      note(
        "gaussians",
        "Gaussians",
        `The **normal (Gaussian) distribution** $\\mathcal{N}(\\mu, \\sigma^2)$ is the noise of choice in diffusion, and for good reason.

**Definition.** A Gaussian is fully described by its mean $\\mu$ and variance $\\sigma^2$, with density
$$p(x) = \\frac{1}{\\sqrt{2\\pi\\sigma^2}} \\exp\\!\\left(-\\frac{(x-\\mu)^2}{2\\sigma^2}\\right).$$

**The magic property.** Sums of independent Gaussians are again Gaussian, and Gaussians stay Gaussian under linear maps. This *closure* is what makes the forward process tractable: we can jump directly from $x_0$ to any step $x_t$ in closed form,
$$x_t = \\sqrt{\\bar{\\alpha}_t}\\, x_0 + \\sqrt{1 - \\bar{\\alpha}_t}\\, \\epsilon, \\quad \\epsilon \\sim \\mathcal{N}(0, I),$$
without simulating all the intermediate steps.

**Worked example.** Adding $\\mathcal{N}(0, 0.1)$ noise to a pixel value $0.7$ gives a new value centred at $0.7$ with spread $\\sqrt{0.1}$. Repeat enough times and the original signal is washed out.

*Feeds forward:* Gaussians are the building block of the DDPM forward and reverse steps.`,
      ),
      note(
        "gradients",
        "Gradients",
        `Training any modern model means **gradient descent**, and diffusion is no exception.

**Definition.** For a loss $L(\\theta)$, the gradient $\\nabla_\\theta L$ is the vector of partial derivatives — it points in the direction of *steepest increase*. We move the opposite way:
$$\\theta \\leftarrow \\theta - \\eta\\, \\nabla_\\theta L,$$
where $\\eta$ is the learning rate.

**Why it matters here.** The denoiser $\\epsilon_\\theta$ has millions of parameters. We can't solve for them analytically; instead we nudge them downhill on the noise-prediction loss, one mini-batch at a time.

**Intuition.** Imagine a foggy hillside. You can't see the valley, but you can feel the slope under your feet. Gradient descent is repeatedly stepping downhill by the local slope — exactly what an optimiser like Adam automates.

*Feeds forward:* gradients are the optimisation engine for the neural network denoiser.`,
      ),
      note(
        "neural-nets",
        "Neural networks",
        `A **neural network** is a stack of learnable linear maps interleaved with nonlinearities — a flexible function approximator.

**Structure.** Each layer computes $h = \\sigma(Wx + b)$, where $W, b$ are learned and $\\sigma$ is a nonlinearity (ReLU, GELU). Stack many layers and the network can represent very complex functions.

**The diffusion denoiser.** Diffusion uses a **U-Net**: an encoder that compresses the image, a decoder that expands it back, and skip connections that preserve detail. It takes a noisy image $x_t$ and the step index $t$, and outputs a prediction of the noise $\\epsilon_\\theta(x_t, t)$.

**Why a U-Net.** Denoising needs both global structure (what object is this?) and local detail (sharp edges). The encoder captures the former, the skip connections restore the latter.

*Feeds forward:* this trained network is the reverse process — the part that actually generates samples.`,
      ),
      note(
        "markov-chains",
        "Markov chains",
        `The forward (noising) process is a **Markov chain**: each state depends only on the immediately previous one.

**Definition.** A sequence $x_0, x_1, \\dots, x_T$ is Markov if
$$q(x_t \\mid x_{t-1}, \\dots, x_0) = q(x_t \\mid x_{t-1}).$$
The future is independent of the past *given the present*.

**Why it helps.** This factorises the joint distribution into a product of simple one-step transitions:
$$q(x_{1:T} \\mid x_0) = \\prod_{t=1}^{T} q(x_t \\mid x_{t-1}).$$
Each transition just adds a touch of Gaussian noise, so the whole chain is easy to define and to reason about.

**Worked intuition.** A board game where your next position depends only on your current square and the dice — not on how you got there — is Markov. Diffusion's noising is the same: step $t$ only looks at step $t-1$.

*Feeds forward:* the Markov structure is what lets DDPM learn a *per-step* reverse transition.`,
      ),
      note(
        "ddpm",
        "Denoising diffusion (DDPM)",
        `Now everything comes together. A **Denoising Diffusion Probabilistic Model** noises data, then learns to reverse it.

**Forward.** Over $T$ steps, gradually corrupt $x_0$ into near-pure noise $x_T$ using the Gaussian Markov chain above.

**Reverse (the learned part).** Train the U-Net to predict the noise added at each step. The remarkable result is that the training objective collapses to a plain regression:
$$\\mathcal{L} = \\mathbb{E}_{t, x_0, \\epsilon}\\big[\\lVert \\epsilon - \\epsilon_\\theta(x_t, t)\\rVert^2\\big].$$

**Sampling.** Start from $x_T \\sim \\mathcal{N}(0, I)$ and iteratively denoise:
$$x_{t-1} = \\frac{1}{\\sqrt{\\alpha_t}}\\Big(x_t - \\frac{1-\\alpha_t}{\\sqrt{1-\\bar{\\alpha}_t}}\\, \\epsilon_\\theta(x_t, t)\\Big) + \\sigma_t z.$$
After $T$ steps a clean, novel sample emerges.

**Putting it in one line.** *Destroy structure with noise on a schedule; train a network to undo one step of that noise; then run it backwards from pure noise to create something new.*

*This is the destination of the whole prerequisite graph.*`,
      ),
    ],
  },
  {
    id: "kalman-filters",
    title: "Kalman Filters",
    topic: "Kalman filters",
    blurb: "Linear algebra and Bayesian updates to optimal state estimation.",
    conceptCount: 6,
    report: `## Research report — Kalman filters

**Goal.** Estimate the hidden state of a moving system (position, velocity, orientation…) from noisy measurements, optimally, in real time.

### Why it matters
The Kalman filter is one of the most-deployed algorithms in engineering: it guides spacecraft (it flew on Apollo), fuses GPS + accelerometers in your phone, tracks objects in radar, and stabilises drones. Wherever sensors are noisy but cheap, a Kalman filter squeezes out a clean estimate.

### The big idea
Maintain a belief about the state as a **Gaussian** — a mean (best guess) plus a covariance (uncertainty). Then alternate two moves:
1. **Predict** — push the belief forward through the system dynamics; uncertainty grows.
2. **Update** — fold in a new measurement via Bayes' rule; uncertainty shrinks.

The *Kalman gain* is the optimal weighting between prediction and measurement.

### Prerequisite structure
**Linear algebra** supplies vectors/matrices for the state and dynamics; **Probability** and **Gaussians** model uncertainty; **State-space models** describe the system; **Bayesian update** is the fusion rule. All of it culminates in the **Kalman filter**.

\`\`\`mermaid
graph LR
  LA[Linear algebra] --> SS[State-space models]
  P[Probability] --> G[Gaussians]
  G --> BU[Bayesian update]
  SS --> K[Kalman filter]
  BU --> K
\`\`\`

### Key equations
Predict: $\\hat{x}^- = F\\hat{x}, \\; P^- = FPF^\\top + Q$.
Update: $K = P^- H^\\top (HP^-H^\\top + R)^{-1}$, then $\\hat{x} = \\hat{x}^- + K(z - H\\hat{x}^-)$.

### What to learn next
The Extended and Unscented Kalman filters (for nonlinear systems), and particle filters (for non-Gaussian beliefs).`,
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
        `Kalman filters live in the world of **vectors and matrices**, so we start there.

**The objects.** The state is a vector $x$ (e.g. $[\\text{position}, \\text{velocity}]^\\top$). Dynamics are a matrix $F$ that maps the current state to the next. Measurements relate to the state through a matrix $H$.

**Operations you need.** Matrix–vector products $Fx$ (apply dynamics), transposes $F^\\top$ (used in covariance propagation), and matrix inverses (used to compute the Kalman gain).

**Worked example.** For constant-velocity motion with timestep $\\Delta t$,
$$F = \\begin{bmatrix} 1 & \\Delta t \\\\ 0 & 1 \\end{bmatrix}, \\quad x = \\begin{bmatrix} p \\\\ v \\end{bmatrix}, \\quad Fx = \\begin{bmatrix} p + v\\,\\Delta t \\\\ v \\end{bmatrix}.$$
Position advances by velocity × time — exactly what we expect.

*Feeds forward:* this matrix language defines the state-space model.`,
      ),
      note(
        "probability",
        "Probability",
        `Every estimate the filter produces carries **uncertainty**, so probability is woven throughout.

**Key idea.** We never claim "the position is exactly 4.2 m." We say "the position is *around* 4.2 m, give or take." That spread is variance, and across multiple state variables it becomes a *covariance matrix* $P$.

**Conditioning is the whole game.** A measurement updates our belief: prior belief about the state, combined with the likelihood of the measurement, yields a posterior. That is conditional probability in action.

**Intuition.** Think of your belief as a fuzzy cloud in state-space. Prediction stretches the cloud; measurement squeezes it. The filter is bookkeeping for that cloud.

*Feeds forward:* probability lets us specialise to the Gaussian case.`,
      ),
      note(
        "gaussians",
        "Gaussians",
        `The Kalman filter assumes the state belief and all noise are **Gaussian**, summarised by a mean $\\hat{x}$ and covariance $P$.

**Why Gaussians.** Two facts make the filter *exact*:
1. A Gaussian pushed through a linear map stays Gaussian.
2. The product of two Gaussians (Bayes' update) is again Gaussian.

So if we start Gaussian and the system is linear, we *stay* Gaussian forever, and only ever need to track $\\hat{x}$ and $P$.

**Covariance, concretely.** $P$ is a matrix whose diagonal holds the variance of each state variable and whose off-diagonals capture correlations (e.g. position and velocity uncertainty are linked).

**Worked intuition.** A 2-D Gaussian belief looks like an ellipse: its centre is the best guess, its width is the uncertainty. Prediction tilts and grows the ellipse; updates shrink it.

*Feeds forward:* Gaussians make the Bayesian update a closed-form matrix formula.`,
      ),
      note(
        "state-space",
        "State-space models",
        `A **state-space model** is the description of the system the filter operates on.

**Two equations.** A hidden state evolves, and we observe it noisily:
$$x_t = F x_{t-1} + w, \\qquad z_t = H x_t + v,$$
where $w \\sim \\mathcal{N}(0, Q)$ is *process noise* (the model isn't perfect) and $v \\sim \\mathcal{N}(0, R)$ is *measurement noise* (the sensor isn't perfect).

**Reading the symbols.** $F$ moves the state forward, $H$ maps state to what we can measure, $Q$ and $R$ encode how much we trust the model vs. the sensor.

**Worked example.** Tracking a car: the state is position + velocity, $F$ advances position by velocity, $H = [1, 0]$ because the GPS measures only position, not velocity. The filter *infers* velocity even though no sensor reports it.

*Feeds forward:* this model is exactly what the predict step propagates.`,
      ),
      note(
        "bayesian-update",
        "Bayesian update",
        `Each measurement refines belief through **Bayes' rule**: prior × likelihood ∝ posterior.

**The principle.** Before the measurement you have a prediction (the prior). The measurement has a likelihood given each possible state. Multiply them and renormalise to get the updated belief (the posterior).

**The Kalman gain.** For Gaussians this multiplication has a closed form. The *gain* $K$ decides how much to trust the new measurement versus the prediction:
$$K = P^- H^\\top (H P^- H^\\top + R)^{-1}.$$
- If the sensor is very noisy ($R$ large), $K \\to 0$: trust the prediction.
- If the prediction is very uncertain ($P^-$ large), $K$ grows: trust the measurement.

**Update step.** $\\hat{x} = \\hat{x}^- + K(z - H\\hat{x}^-)$ nudges the estimate toward the measurement by a fraction $K$ of the *innovation* $z - H\\hat{x}^-$.

*Feeds forward:* this is the "correct" half of the Kalman loop.`,
      ),
      note(
        "kalman",
        "Kalman filter",
        `Assemble the pieces and you get the **Kalman filter** — the optimal estimator for linear-Gaussian systems.

**The loop.** Repeat forever:

1. **Predict**
$$\\hat{x}^- = F\\hat{x}, \\qquad P^- = F P F^\\top + Q.$$
Push the state forward; uncertainty grows by the process noise $Q$.

2. **Update**
$$K = P^- H^\\top (H P^- H^\\top + R)^{-1},$$
$$\\hat{x} = \\hat{x}^- + K(z - H\\hat{x}^-), \\qquad P = (I - KH)P^-.$$
Fold in the measurement; uncertainty shrinks.

**Why "optimal."** Among all linear estimators, the Kalman filter minimises the mean-squared error — no other linear rule does better on a linear-Gaussian system.

**One-line summary.** *Guess, then correct: predict the state forward, then pull it toward each measurement by exactly the amount your relative confidence warrants.*

*This is the destination of the whole prerequisite graph.*`,
      ),
    ],
  },
  {
    id: "byzantine-consensus",
    title: "Byzantine Consensus",
    topic: "Byzantine consensus",
    blurb: "Distributed systems fundamentals up to BFT agreement.",
    conceptCount: 6,
    report: `## Research report — Byzantine consensus

**Goal.** Get a set of independent machines to agree on a single value *even when some of them are faulty or actively malicious*.

### Why it matters
Byzantine fault tolerance (BFT) underpins blockchains, aircraft control buses, and high-integrity databases. Whenever you cannot trust every participant — because hardware fails strangely or because an adversary controls some nodes — BFT consensus is what keeps the system safe and live.

### The big idea
Agreement is easy when machines only *crash*. It becomes hard when machines can *lie*, *equivocate* (tell different things to different peers), or *collude*. The central results:
- With only crash faults, you need $2f + 1$ nodes to tolerate $f$ failures.
- With Byzantine faults, you need $3f + 1$ nodes to tolerate $f$, plus cryptographic authentication and *intersecting quorums*.

### Prerequisite structure
**Processes & messages** set the model; **Failure models** classify how nodes break; **Crash consensus** is the easier baseline; **Quorums** provide the safety backbone; **Byzantine faults** introduce adversaries; **PBFT** is the classic protocol that ties it together.

\`\`\`mermaid
graph LR
  PM[Processes & messages] --> FM[Failure models]
  FM --> CC[Crash consensus]
  FM --> BF[Byzantine faults]
  CC --> Q[Quorums]
  Q --> PBFT[PBFT]
  BF --> PBFT
\`\`\`

### Key result
PBFT reaches agreement with $3f+1$ replicas despite $f$ Byzantine ones, using a three-phase protocol (pre-prepare → prepare → commit) where each phase gathers a quorum of $2f+1$ matching messages.

### What to learn next
View changes and leader election in PBFT, the FLP impossibility result, and modern BFT (Tendermint, HotStuff) used in blockchains.`,
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
        `A distributed system is a set of **processes** that coordinate only by exchanging **messages** over a network.

**The setting.** There is no shared memory and no global clock. Messages can be delayed, reordered, or (in some models) lost. Each process sees only its own local state plus whatever messages arrive.

**Why this is the foundation.** Every difficulty in consensus stems from this: you can never be sure *when* a message will arrive, or whether silence means "still computing" or "crashed." Time and certainty are luxuries you don't have.

**Worked intuition.** Picture generals on separate hills who can only send couriers. A courier may be slow or captured. Any agreement protocol must work *despite* that unreliability — you cannot assume a reply means anything until it actually arrives.

*Feeds forward:* on top of this model we define how processes can fail.`,
      ),
      note(
        "failure-models",
        "Failure models",
        `Before designing a protocol we must specify **how nodes are allowed to break** — the failure model dictates what is achievable.

**The spectrum.**
- **Crash (fail-stop):** a node simply halts and sends nothing more. Honest until silent.
- **Omission:** a node drops some messages but is otherwise correct.
- **Byzantine:** a node may do *anything* — send wrong values, send conflicting values to different peers, or collude with other faulty nodes.

**Why the model is everything.** A protocol proven correct under crash faults can be *completely broken* by a single Byzantine node. The stronger the adversary you assume, the more redundancy and cryptography you need.

**Worked intuition.** Crash = a teammate who goes quiet. Byzantine = a teammate who actively lies to split the group. Defending against the liar is far harder.

*Feeds forward:* the crash model leads to crash consensus; the Byzantine model leads to PBFT.`,
      ),
      note(
        "crash-consensus",
        "Crash consensus",
        `When nodes can only **crash**, agreement is achievable with well-known protocols — a useful baseline before adversaries enter.

**The guarantee.** Protocols like **Paxos** and **Raft** let a cluster agree on a sequence of values as long as a *majority* stays up. They tolerate $f$ crash failures with $2f + 1$ nodes.

**Mechanism in brief.** A leader proposes a value; followers accept it; once a majority has accepted, the value is *committed* and will survive any future leader because any new majority overlaps the old one.

**Worked example.** With 5 nodes you tolerate $f = 2$ crashes: any decision needs 3 acceptances, and any later majority of 3 must share at least one node with the earlier 3, so the committed value is never lost.

*Feeds forward:* that "any two majorities overlap" idea is exactly the quorum principle.`,
      ),
      note(
        "quorums",
        "Quorums",
        `A **quorum** is a set of nodes large enough that any two quorums must share at least one member. That intersection is the safety backbone of consensus.

**Definition.** In a system of $n$ nodes, a simple majority quorum has size $\\lfloor n/2 \\rfloor + 1$. Any two such sets necessarily overlap, because two subsets each larger than half of $n$ cannot be disjoint.

**Why intersection = safety.** If decision A was approved by one quorum and a later decision B by another, the overlapping node "remembers" A and prevents a conflicting B. No two contradictory values can both be committed.

**Byzantine quorums.** Against liars you need a stronger condition: quorums of size $2f + 1$ out of $3f + 1$, so that any two quorums overlap in at least $f + 1$ nodes — guaranteeing at least one *honest* node in common.

**Worked example.** With $n = 4$ and $f = 1$: quorum size $3$. Two quorums of 3 from 4 nodes overlap in $\\geq 2$ nodes, at least one of which is honest.

*Feeds forward:* PBFT collects exactly these $2f+1$ quorums in each phase.`,
      ),
      note(
        "byzantine-faults",
        "Byzantine faults",
        `**Byzantine** nodes are the worst case: they can lie, equivocate, and collude arbitrarily.

**What they can do.** Send a "yes" to half the network and a "no" to the other half; forge or replay messages; stay silent strategically; coordinate with other faulty nodes to maximise damage.

**Why this breaks naive protocols.** Crash-tolerant protocols assume any message received is *truthful*. A Byzantine node violates that, so a single liar can convince different honest nodes of different "decisions" — destroying agreement.

**The defences.**
1. **Cryptographic signatures** so messages can't be forged and lies can be attributed.
2. **Larger quorums** ($3f + 1$ total) so every two quorums share an honest node.
3. **Multiple rounds** so nodes can cross-check what others claim to have seen.

**Worked intuition.** If one general might be a traitor sending contradictory orders, the loyal generals must compare notes across several rounds before acting — exactly what BFT protocols formalise.

*Feeds forward:* PBFT combines signatures, $3f+1$ quorums, and multiple phases.`,
      ),
      note(
        "pbft",
        "PBFT",
        `**Practical Byzantine Fault Tolerance** (Castro & Liskov, 1999) reaches agreement with $3f + 1$ replicas despite $f$ Byzantine ones.

**The three phases.** For each client request, a designated *primary* drives a round:
1. **Pre-prepare** — the primary proposes an order for the request.
2. **Prepare** — replicas broadcast agreement; each waits for a quorum of $2f + 1$ matching prepares. This pins down a unique order and defeats equivocation.
3. **Commit** — replicas broadcast commit; after $2f + 1$ commits, they execute the request and reply to the client.

**Why it's safe.** Each phase gathers an intersecting quorum, so any two quorums share at least one honest replica — no two honest replicas can commit conflicting orders.

**Why it's live.** If the primary is faulty (e.g. silent or equivocating), replicas trigger a **view change** to elect a new primary and continue.

**One-line summary.** *Use signatures so nobody can forge, $3f+1$ replicas so honest majorities always overlap, and three quorum-gathering rounds so a unique order is agreed despite liars.*

*This is the destination of the whole prerequisite graph.*`,
      ),
    ],
  },
  {
    id: "transformers",
    title: "Transformers",
    topic: "Transformer neural networks",
    blurb: "Linear algebra and attention up to the full transformer block.",
    conceptCount: 6,
    report: `## Research report — Transformers

**Goal.** Understand the architecture behind modern language models (GPT, BERT, Llama): how self-attention lets a network relate every token to every other token in parallel.

### Why it matters
Transformers replaced RNNs as the backbone of NLP and now power vision, audio, and protein-folding models. Their key advantage is *parallelism*: unlike recurrent networks they process a whole sequence at once, which is why they scale to billions of parameters and trillions of tokens.

### The big idea
Represent each token as a vector, then let tokens **attend** to one another: every token gathers information from the others, weighted by relevance. Stack this operation with feed-forward layers, residual connections, and normalisation, and you get a Transformer block — repeat it $N$ times for a full model.

### Prerequisite structure
**Linear algebra** is the substrate (everything is matrix multiplications); **Softmax** turns scores into weights; **Embeddings** turn tokens into vectors; these three meet in **Attention**; add **Positional encoding** for order, and you can build the full **Transformer block**.

\`\`\`mermaid
graph LR
  LA[Linear algebra] --> A[Attention]
  S[Softmax] --> A
  E[Embeddings] --> A
  A --> TB[Transformer block]
  PE[Positional encoding] --> TB
\`\`\`

### Key equation
Scaled dot-product attention:
$$\\text{Attention}(Q, K, V) = \\text{softmax}\\!\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right) V.$$

### What to learn next
Multi-head attention in depth, layer normalisation vs. RMSNorm, the difference between encoder-only (BERT), decoder-only (GPT), and encoder–decoder (T5) variants, and how pretraining objectives shape what the model learns.`,
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
        `Transformers are **matrix multiplications end to end**, so fluency with vectors and matrices is the entry ticket.

**The core operation.** Given an input matrix $X$ (rows = tokens, columns = features), a linear layer computes $XW$ for a learned weight matrix $W$. Queries, keys, and values are all such projections:
$$Q = XW_Q, \\quad K = XW_K, \\quad V = XW_V.$$

**What you need comfort with.** Matrix products (shapes must line up), transposes (the $K^\\top$ in attention), and the idea that a matrix multiply applies the *same* linear transformation to every token in parallel.

**Worked example.** If $X$ is $4 \\times 8$ (4 tokens, 8 features) and $W_Q$ is $8 \\times 6$, then $Q = XW_Q$ is $4 \\times 6$ — each of the 4 tokens now has a 6-dimensional query.

*Feeds forward:* these $Q, K, V$ projections are the raw material of attention.`,
      ),
      note(
        "softmax",
        "Softmax",
        `**Softmax** converts a vector of arbitrary scores into a probability distribution — the mechanism that turns attention scores into weights.

**Definition.**
$$\\text{softmax}(z)_i = \\frac{e^{z_i}}{\\sum_j e^{z_j}}.$$
Every output is positive and they sum to 1, so they behave like probabilities.

**Properties that matter.** Larger inputs get exponentially larger weights (it sharpens differences), and the operation is differentiable, so it slots into gradient-based training.

**Worked example.** $\\text{softmax}([2, 1, 0]) \\approx [0.66, 0.24, 0.10]$. The biggest score dominates but the others still get some weight — soft, not winner-take-all.

**Why "scaled."** In attention the scores are divided by $\\sqrt{d_k}$ before softmax; without that, large dimensions push softmax into a near one-hot regime with vanishing gradients.

*Feeds forward:* softmax normalises the attention scores into mixing weights.`,
      ),
      note(
        "embeddings",
        "Embeddings",
        `An **embedding** maps a discrete token (a word or subword) to a continuous vector the network can compute with.

**Mechanism.** A lookup table $E$ has one learned row per vocabulary entry. Token id $i$ becomes the vector $E_i \\in \\mathbb{R}^{d}$. These vectors are learned jointly with the rest of the model.

**Why continuous vectors.** Neural networks operate on real-valued vectors, not symbols. Embeddings also place *similar* tokens near each other, so the model gets a useful geometry for free — "king" and "queen" end up close, and directions in the space can encode meaning.

**Worked intuition.** After training, vector arithmetic often works: $\\text{king} - \\text{man} + \\text{woman} \\approx \\text{queen}$. That structure emerges because related words are pushed together during training.

*Feeds forward:* embeddings are the input vectors that get projected into $Q, K, V$.`,
      ),
      note(
        "attention",
        "Attention",
        `**Scaled dot-product attention** is the heart of the Transformer: each token gathers information from every other token, weighted by relevance.

**The formula.**
$$\\text{Attention}(Q, K, V) = \\text{softmax}\\!\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right) V.$$

**Reading it step by step.**
1. $QK^\\top$ scores how well each query (what a token is looking for) matches each key (what each token offers).
2. Divide by $\\sqrt{d_k}$ to keep scores in a stable range.
3. Softmax turns each row of scores into mixing weights that sum to 1.
4. Multiply by $V$ to take a weighted average of the value vectors.

**Multi-head.** Instead of one attention, run several in parallel ("heads"), each with its own $W_Q, W_K, W_V$, then concatenate. Different heads can specialise — one tracks syntax, another long-range references.

**Worked intuition.** In "the animal didn't cross the street because *it* was tired," attention lets *it* attend strongly to *animal*, resolving the reference.

*Feeds forward:* attention is the first sublayer of the Transformer block.`,
      ),
      note(
        "positional-encoding",
        "Positional encoding",
        `Attention is **order-agnostic** — it treats the input as a set — so we must inject **position** information explicitly.

**The problem.** $\\text{softmax}(QK^\\top)V$ gives the same result if you shuffle the tokens, because it has no notion of "first" or "next." But word order carries meaning ("dog bites man" ≠ "man bites dog").

**The fix.** Add a position-dependent vector to each token embedding. The original Transformer uses fixed sinusoids of varying frequency:
$$PE_{(pos, 2i)} = \\sin\\!\\left(\\frac{pos}{10000^{2i/d}}\\right), \\quad PE_{(pos, 2i+1)} = \\cos\\!\\left(\\frac{pos}{10000^{2i/d}}\\right).$$
Modern models often use *learned* or *rotary* (RoPE) encodings instead.

**Why sinusoids.** Different frequencies let the model represent both fine (adjacent) and coarse (long-range) positional differences, and relative offsets become linear functions of the encoding.

*Feeds forward:* position-aware embeddings enter the Transformer block alongside attention.`,
      ),
      note(
        "transformer-block",
        "Transformer block",
        `A **Transformer block** assembles attention and a feed-forward network into the repeatable unit of the whole model.

**Anatomy.** Each block has two sublayers:
1. **Multi-head self-attention** — tokens exchange information.
2. **Position-wise feed-forward network (FFN)** — each token is independently transformed by an MLP, e.g. $\\text{FFN}(x) = W_2\\,\\text{GELU}(W_1 x)$.

Each sublayer is wrapped with a **residual connection** and **layer normalisation**:
$$x' = \\text{LayerNorm}(x + \\text{Attention}(x)), \\quad y = \\text{LayerNorm}(x' + \\text{FFN}(x')).$$

**Why residuals + norm.** Residual connections let gradients flow through very deep stacks; layer norm keeps activations well-scaled. Together they make it possible to stack dozens of blocks.

**The full model.** Stack $N$ identical blocks (12 in the original, 96+ in large LMs), add embeddings + positional encodings at the input and a linear head at the output, and you have a Transformer.

**One-line summary.** *Embed tokens, add position, let them attend to each other, transform each one through an MLP, wrap everything in residuals and normalisation, and repeat.*

*This is the destination of the whole prerequisite graph.*`,
      ),
    ],
  },
];

/** Public projects with each node's definition/summary backfilled from its note. */
export const EXAMPLE_PROJECTS: ExampleProject[] = RAW_PROJECTS.map(withNodeDetails);
