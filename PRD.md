# PRD — Knowledge-Graph Learning App

> Single source of truth for every agent in the `kg-learn-*` suite. The orchestrator and
> each module agent **read this file first** and keep their work consistent with it. If code
> and this PRD disagree, this PRD wins — update the PRD deliberately, never fork it silently.

## 1. One-paragraph product

A learning-curve-minimizing web app. A user enters a **topic or prompt**; multi-agent web
research builds a **prerequisite knowledge graph that grows live on screen**; an upfront
adaptive quiz gauges the user's level and marks already-known concepts; then the app
generates **level-adapted lectures in topological order with forward-reference 0** (no lecture
uses a concept the learner has not yet been taught or already knows), rendered as text +
Mermaid + KaTeX, one at a time on demand. Multi-user, deployed to Azure with GitHub Actions CI/CD.

## 2. Problem & target user

- **Problem it kills:** the "I read an explanation, but the explanation's own words also need
  explaining" loop. Linear courses and search results assume background the learner may not have.
- **Target user:** a self-directed learner (student, engineer, researcher) who wants to go from
  zero to competent on an unfamiliar topic without hitting undefined jargon.
- **Proven benefit:** every lecture is guaranteed readable with only concepts already taught or
  already known — a measurable, enforced property (see §6 keystone), not a vibe.

## 3. Competition context (lipcoding 2026 — non-negotiable)

- Personal-productivity **web app**.
- **MUST use the GitHub Copilot SDK** (`@github/copilot-sdk`) as the AI layer.
- **MUST deploy to Azure**, with the model layer on **Azure AI Foundry / Azure OpenAI** (BYOK).
- Judged on: effective Copilot SDK use (25%), productivity impact (18%), Azure AI/cloud
  integration (18%), functionality/execution (16%), UX (12%), responsible AI/security (6%),
  innovation (5%).

## 4. Hard constraints (never compromise, even if asked to "simplify")

1. **AI layer = GitHub Copilot SDK only.** Every planning/generation/agentic call goes through
   `src/lib/ai/copilot.ts` (`CopilotProvider`). No `openai`, `@anthropic-ai/sdk`, or any other
   vendor AI SDK anywhere in app code. `copilot.ts` is the *only* file that imports the SDK.
2. **Model backend = Azure AI Foundry via BYOK.** Every `createSession` passes
   `provider: { type: "openai", baseUrl: <FOUNDRY endpoint normalized to end with "/openai/v1/">,
   apiKey: process.env.AZURE_AI_FOUNDRY_API_KEY, wireApi: "responses" }` plus a **required**
   `model: process.env.FOUNDRY_DEPLOYMENT_NAME`. `type` is `"openai"`, not `"azure"`. The SDK does
   **not** auto-read `AZURE_AI_FOUNDRY_*` — the app reads those env names and maps them in.
3. **Deploy = Azure only.** Host on Azure App Service *or* Azure Container Apps. Never AWS/GCP/
   Vercel/Netlify, never a non-Azure model backend.
4. **Production must never silently fall back to GitHub-hosted models.** If `NODE_ENV==="production"`
   and no Foundry provider is configured, **throw**. `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN`
   are a **dev-only** fallback (non-Azure GitHub-hosted models) — never set them in any deployed env.
5. **Runtime realities of the SDK** (verify at research-engine + azure-deployer):
   - The SDK always spawns the Copilot CLI runtime (Node ≥20.19 / ≥22.12); there is **no** CLI-less
     direct-to-Foundry transport. BYOK only swaps which model the runtime calls.
   - Set `COPILOT_HOME` to **per-instance local temp** (e.g. `/tmp/copilot`), never `$HOME` or a
     networked share — session state corrupts under multi-user concurrency on a shared share.
   - The research loop exceeds Azure App Service's hard **~240s** request timeout, so it MUST run in
     a **background worker** and stream only already-produced events over SSE with a `:keep-alive`
     heartbeat **<60s**. Never run the multi-round loop inside an HTTP handler.

## 5. Default stack (constraints in §4 are fixed; the rest is overridable only on user request)

Next.js (App Router, TypeScript) full-stack on Node (`engines.node = "^20.19.0 || >=22.12.0"`) ·
Cytoscape.js (+ `cytoscape-fcose`) · **SSE** for server→client graph events · Prisma
(**SQLite** local dev / **PostgreSQL** prod) · Auth.js (NextAuth, Entra ID option) ·
**GitHub Copilot SDK (BYOK → Azure AI Foundry)** · **Azure App Service or Container Apps** +
GitHub Actions CI/CD.

> This repo is a non-standard Next.js — read `node_modules/next/dist/docs/` (per `AGENTS.md`)
> before writing Next.js code.

## 6. Keystone success criterion (the one rule that defines success)

**forward-reference 0** — the generated lecture sequence never uses a concept the learner has not
yet been taught (or already knows). The scaffold ships the guard, the lecture-generator enforces it
with a gate + unit test, and CI blocks release if that test regresses. Everything else serves this.

## 7. Shared data contract (the ontology — never fork)

Defined once in `src/lib/ontology/types.ts`; guards in `src/lib/ontology/invariants.ts`. Every
module imports from these; no module redefines them.

Types: `Concept`, `PrerequisiteEdge` (from = prerequisite OF to; DAG only), `GraphStatus`
(`idle|researching|converged|stopped`), `KnowledgeGraph`, `GraphEvent` (`node|edge|status`),
`AssessmentQuestion`, `DepthProfile`, `UserLevel`, `Lecture`, `LearningPath`, `UserProgress`,
`WebSource`.

Guards (runtime invariants every module upholds):
- `wouldCreateCycle(graph, edge): boolean` — reject edges that break the DAG.
- `topoSort(graph): string[]` — topological order for lecture sequencing.
- `findForwardReferences(lecture, allowedConceptIds, graph): string[]` — offenders, **must be empty**.
- Convergence: research stops when new-concept growth falls below a threshold, bounded by a safety
  budget cap (tokens / wall-clock / sources).

## 8. Build pipeline (each module verifies its ACs before the next runs)

| # | Agent | Builds | Key ACs |
|---|-------|--------|---------|
| 1 | `kg-learn-scaffold`     | Skeleton, ontology contract, invariant guards, Copilot wrapper, Prisma | guards smoke test |
| 2 | `research-engine`       | Topic → streaming DAG, convergence + budget, SSE + background worker | AC-1/2/3/6/7 |
| 3 | `level-assessor`        | Upfront adaptive quiz → `UserLevel` + known-node baseline | AC-4/5 |
| 4 | `kg-graph-viz`          | Live growing Cytoscape view over SSE, node interaction | AC-7/8 |
| 5 | `lecture-generator`     | Topo-order, forward-ref-0 lectures (text+Mermaid+KaTeX), on demand | AC-9/10/11 |
| 6 | `azure-deployer`        | Azure App Service/Container Apps + GitHub Actions + multi-user persistence | AC-12/13 |
| 7 | `kg-learn-orchestrator` | Drives 1–6 in order, verifies ACs, routes voice commands | all |

## 9. Acceptance criteria

- **AC-1** — A topic/prompt input alone starts research (no file upload in v1).
- **AC-2** — Extracts concepts AND prerequisite relationships from web/scholarly sources.
- **AC-3** — Auto-stops on convergence and never exceeds the safety budget cap.
- **AC-4** — 3–5 adaptive questions run BEFORE any lecture.
- **AC-5** — Assessment results feed both the known-node set and lecture depth.
- **AC-6** — The knowledge graph is a cycle-free DAG.
- **AC-7** — Nodes/edges appear in real time via SSE (streaming, not polling, not batch-after-build).
- **AC-8** — Basic graph interaction works (click → detail panel, hover, zoom).
- **AC-9 (KEYSTONE)** — The generated lecture sequence has forward-reference = 0, enforced by the
  gate + a unit test asserting zero offenders across a full generated path on a fixture graph.
- **AC-10** — Lectures are generated one at a time in topological order; "next" builds on prior ones.
- **AC-11** — Lectures render text + Mermaid + KaTeX.
- **AC-12** — Multi-user: login works; each user's graph/progress is persisted and isolated.
- **AC-13** — Live at a public Azure URL; `git push` to `main` auto-deploys; health checks pass,
  including an `ai-health` probe confirming the live model `base_url` is the Azure Foundry endpoint.

## 10. Required configuration (env)

> **Deploy is pre-configured for one shot.** `infra/azure.defaults.json` fixes region, resource
> names, SKUs, Postgres, the Foundry model/deployment, Key Vault, auth, and CI, so `deploy` runs
> without asking. Defaults: hosting **koreacentral** (App Service B1, Node 22), Foundry **eastus2**
> (**gpt-5** for lectures/assessment + **gpt-5-mini** for high-volume research), Postgres Flexible **Standard_B1ms** v16, secrets in **Azure Key Vault**, auth via
> **Entra ID**, CI via **GitHub Actions OIDC** on `main`. The only interactive step is `az login`
> once; the only user-supplied secret is the web-search key (`TAVILY_API_KEY`).

- `AZURE_AI_FOUNDRY_ENDPOINT`, `AZURE_AI_FOUNDRY_API_KEY`, `FOUNDRY_DEPLOYMENT_NAME` (quality tier,
  `gpt-5`) + `FOUNDRY_FAST_DEPLOYMENT_NAME` (cost/speed tier, `gpt-5-mini`, used by research
  extraction) — BYOK backend (created during deploy; key stored in Azure Key Vault).
- `DATABASE_URL` — `file:./dev.db` locally; Azure PostgreSQL in prod (CI flips the Prisma provider).
- `AUTH_SECRET` (+ Entra ID creds if used).
- A web-search provider key (Tavily / Bing / SerpAPI) — intentionally exempt from the Azure-only
  rule (egress, not a host/model).
- `COPILOT_HOME` — per-instance local temp.
- `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` — **dev-only** fallback; never in deployed env.

## 11. Out of scope (v1)

File/document uploads as a research source; collaborative/multi-learner shared graphs; mobile-native
clients; offline mode; non-Azure model or hosting options.
