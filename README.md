# Knowledge-Graph Learning App

A learning-curve-minimizing web app. Enter a **topic or prompt** → multi-agent web
research builds a **prerequisite knowledge graph that grows live on screen** → an
upfront adaptive quiz gauges your level and marks already-known concepts → the app
generates **level-adapted lectures in topological order with forward-reference 0**
(no lecture uses a concept you have not yet been taught or already know), rendered as
text + Mermaid + KaTeX, one at a time on demand. Multi-user, deployed to Azure.

> **Single source of truth:** [`PRD.md`](./PRD.md). If code and the PRD disagree, the
> PRD wins. This repo is built by the `kg-learn-*` agent suite — see PRD §8.

## Architecture (scaffold)

| Layer | Choice |
|-------|--------|
| Framework | **Next.js (App Router, TypeScript)** on Node (`^20.19.0 \|\| >=22.12.0`) |
| AI layer | **GitHub Copilot SDK only** — wrapped by `CopilotProvider` in `src/lib/ai/copilot.ts` (the *only* file importing the SDK) |
| Model backend | **Azure AI Foundry via BYOK** (`provider:{type:"openai", baseUrl:".../openai/v1/", wireApi:"responses"}`) — two tiers: `gpt-5` (quality) + `gpt-5-mini` (fast/research) |
| Graph viz | **Cytoscape.js** + `cytoscape-fcose` |
| Live updates | **SSE** (Server-Sent Events) — simpler than WebSocket and clean on Azure App Service |
| Persistence | **Prisma 7** — SQLite (local dev) / PostgreSQL (Azure prod) |
| Auth | **Auth.js (NextAuth)** with an Entra ID option |
| Deploy | **Azure App Service or Container Apps** + GitHub Actions (via `azure-deployer`) |

### The keystone (PRD §6)

**forward-reference 0** — the generated lecture sequence never uses a concept the
learner has not yet been taught or already knows. The scaffold ships the guards
(`src/lib/ontology/invariants.ts`); the lecture-generator enforces them with a gate +
unit test, and CI blocks release if that test regresses.

## Project layout

```
src/
  app/                     # Next.js App Router (routes + SSE handler — TODO by later agents)
  lib/
    ontology/
      types.ts             # Shared domain ontology (THE contract — never fork)
      invariants.ts        # Guards: wouldCreateCycle, topoSort, findForwardReferences
      invariants.smoke.ts  # Guard smoke test (npm run test:guards)
    ai/copilot.ts          # CopilotProvider — the ONLY @github/copilot-sdk importer (BYOK→Foundry)
    db.ts                  # Prisma 7 client singleton (driver adapter by DATABASE_URL)
    research/              # TODO(research-engine)
    assessment/            # TODO(level-assessor)
    graph/                 # TODO(research-engine / kg-graph-viz)
    lectures/              # TODO(lecture-generator)
  components/
    Lecture.tsx            # TODO(lecture-generator) — text + Mermaid + KaTeX
    graph/GraphView.tsx    # TODO(kg-graph-viz) — live Cytoscape over SSE
prisma/
  schema.prisma           # Portable schema (no enum / no String[]): User, Topic, Concept, Edge, Lecture, UserProgress, AssessmentResult
prisma.config.ts          # Prisma 7 config (datasource URL lives here, not in schema)
scripts/set-db-provider.mjs  # Flips the Prisma provider sqlite <-> postgresql
infra/azure.defaults.json # Pre-set Azure deploy defaults (used by azure-deployer)
```

## Getting started (local dev)

```bash
# 1. Configure env
cp .env.example .env        # then fill in values (see "Environment" below)

# 2. Create the local SQLite database (zero DB server)
npm run db:dev              # set-db-provider sqlite + prisma db push

# 3. Run the guard smoke test (the keystone invariants)
npm run test:guards

# 4. Start the dev server
npm run dev                 # http://localhost:3000
```

Other scripts: `npm run build`, `npm run start`, `npm run lint`, `npm run typecheck`.

## Environment

See [`.env.example`](./.env.example) for the full template. Key variables:

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | `file:./dev.db` locally; Azure PostgreSQL in prod (CI flips the provider) |
| `AZURE_AI_FOUNDRY_ENDPOINT` / `AZURE_AI_FOUNDRY_API_KEY` | BYOK → Azure AI Foundry (**mandatory in prod**) |
| `FOUNDRY_DEPLOYMENT_NAME` | Quality tier (`gpt-5`) — lectures, assessment |
| `FOUNDRY_FAST_DEPLOYMENT_NAME` | Fast tier (`gpt-5-mini`) — high-volume research extraction (falls back to quality) |
| `COPILOT_HOME` | Per-instance **local temp** for the Copilot CLI runtime — never `$HOME`/a networked share |
| `AUTH_SECRET` (+ Entra ID creds) | Auth.js session signing |
| `TAVILY_API_KEY` | Web-search provider for research (exempt from the Azure-only rule) |
| `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` | **Dev-only** fallback (non-Azure GitHub-hosted models). **Never set in any deployed environment** — prod throws if no Foundry provider is configured. |

## Hard constraints (never compromise — PRD §4)

1. **AI layer = GitHub Copilot SDK only.** `src/lib/ai/copilot.ts` is the only SDK importer.
2. **Model backend = Azure AI Foundry via BYOK.** `type:"openai"` (the `/openai/v1/` shape), not `"azure"`.
3. **Deploy = Azure only** (App Service or Container Apps). Never a non-Azure host/model.
4. **Production never silently falls back to GitHub-hosted models** — it throws if Foundry is absent.

## Production database swap

Local dev uses SQLite via `prisma db push` (no migration files). For Azure, CI runs
`npm run db:deploy` which flips the provider to PostgreSQL and runs migrations. The
schema stays in the portable subset (no `enum`, no scalar arrays) so the swap is just
the provider line + `DATABASE_URL`. **Never deploy the local SQLite file to Azure.**

## Next steps

This scaffold completes pipeline step 1. Run the agents in PRD §8 order — **next:
`research-engine`** (topic → streaming DAG, convergence + budget, SSE + background worker).
