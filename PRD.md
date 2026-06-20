# PRD — Knowledge-Graph Learning App (KG-Learn)

> **Product Requirement Document** for the KG-Learn application, submitted to the
> **lipcoding 2026 Competition**. This document serves as the single source of truth for
> all features, architecture decisions, and acceptance criteria. Every section explicitly
> maps to the [competition judging criteria](https://github.com/lipcoding-kr/lipcoding-competition-2026/blob/main/judgements/judgement-criteria.md).

---

## 1. Executive Summary

KG-Learn is an **AI-powered adaptive learning platform** that eliminates the biggest barrier
in self-directed education: *encountering unexplained jargon*. A learner enters any topic;
the system autonomously researches it, constructs a **prerequisite knowledge graph** that
grows live on screen, assesses the learner's existing knowledge through an adaptive quiz,
then generates **level-adapted lectures in strict topological order with forward-reference 0**
— mathematically guaranteeing every lecture only uses concepts the learner already knows or
has already been taught.

**Key differentiator:** Forward-reference 0 is not a heuristic — it is a **formally enforced
invariant** with compile-time guards, runtime gates, and CI-blocking unit tests. No other
learning tool provides this guarantee.

---

## 2. Problem Statement & Target User

### 2.1 The Problem

Self-directed learners face a recursive comprehension barrier: they search for Topic A, find
an explanation that uses Terms B, C, and D — each of which requires its own explanation. Linear
courses and textbooks assume prerequisite knowledge the learner may not have. The result is
context-switching, tab-explosion, and eventually giving up.

### 2.2 Target User

| Persona | Description |
|---------|-------------|
| **Student** | Undergraduate/graduate exploring a new domain (e.g., "diffusion models") |
| **Engineer** | Professional pivoting to a new technology stack |
| **Researcher** | Academic entering an adjacent field |

### 2.3 Productivity Impact

> **🏆 Judging Criterion #2 — Productivity Impact & Problem Fit (18%)**

- **Before KG-Learn:** 4–8 hours of tab-hopping, backtracking, and incomplete understanding.
- **After KG-Learn:** Enter a topic → get a complete, ordered learning path in minutes.
- **Measurable benefit:** Every generated lecture has **forward-reference = 0** — a provable,
  testable property, not a subjective claim. The CI pipeline enforces this on every commit.
- **Real-world validation:** 4 complete example projects (Diffusion Models, Kalman Filters,
  Byzantine Consensus, Transformers) each with full research reports and detailed lecture notes
  demonstrate end-to-end value.

---

## 3. Architecture Overview

### 3.1 Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript | Server-rendered responsive web app |
| **Graph Visualization** | Cytoscape.js (2D, fCOSE layout), 3D Force Graph | Interactive prerequisite graph |
| **AI Layer** | **GitHub Copilot SDK** (`@github/copilot-sdk`) | All AI interactions (research, assessment, lectures, chat) |
| **Model Backend** | **Azure AI Foundry** (BYOK: GPT-5 + GPT-5-mini) | Production model inference |
| **Database** | Prisma ORM — SQLite (dev) / **Azure PostgreSQL Flexible** (prod) | Multi-user persistence |
| **Auth** | NextAuth.js — Google OAuth + Microsoft Entra ID | Multi-provider authentication |
| **Hosting** | **Azure App Service** (Node 22 LTS, Korea Central) | Cloud-native deployment |
| **CI/CD** | **GitHub Actions** with Azure OIDC federation | Zero-secret automated deployment |
| **Secrets** | **Azure Key Vault** | Secure credential management |
| **UI Components** | Radix UI (Dialog, Progress, Tooltip), Lucide Icons | Accessible component primitives |
| **Rich Content** | KaTeX (math), Mermaid (diagrams) | Lecture rendering |

### 3.2 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                         │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────────┐  │
│  │ Graph    │ │ Chat     │ │ Assessment│ │ Lectures Library │  │
│  │ (2D/3D) │ │ Panel    │ │ Quiz      │ │ (Generated)      │  │
│  └────┬─────┘ └────┬─────┘ └─────┬─────┘ └────────┬─────────┘  │
│       │SSE         │POST        │POST            │GET          │
└───────┼────────────┼────────────┼────────────────┼─────────────┘
        │            │            │                │
┌───────┴────────────┴────────────┴────────────────┴─────────────┐
│                    Next.js API Routes                           │
│  /api/research/stream  /api/chat  /api/assessment  /api/lectures│
│  /api/lecture  /api/projects  /api/health  /api/ai-health       │
└───────────────────────────┬────────────────────────────────────┘
                            │
┌───────────────────────────┴────────────────────────────────────┐
│              CopilotProvider (src/lib/ai/copilot.ts)           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ GitHub Copilot SDK (@github/copilot-sdk)                │   │
│  │  • createSession() with BYOK Azure Foundry provider     │   │
│  │  • Streaming responses via sendAndWait/stream            │   │
│  │  • Tool calling for structured extraction                │   │
│  └──────────────────────────┬──────────────────────────────┘   │
│                              │ HTTPS                            │
│  ┌──────────────────────────┴──────────────────────────────┐   │
│  │ Azure AI Foundry (East US 2)                            │   │
│  │  • GPT-5 (lectures, assessment, chat)                    │   │
│  │  • GPT-5-mini (high-volume research extraction)          │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────┴────────────────────────────────────┐
│  Azure PostgreSQL Flexible (Korea Central)                      │
│  Prisma ORM — User, Topic, Concept, Edge, Lecture, Assessment   │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. Feature Specification

### 4.1 Multi-Agent Research Engine

> **🏆 Criterion #1 — Effective Use of Copilot SDK (25%)**
>
> The research engine demonstrates **deep, architectural integration** of the Copilot SDK —
> not surface-level prompt wrapping. It uses multi-round agentic sessions with tool calling,
> structured JSON extraction, convergence detection, and streaming — showcasing the SDK's
> full capabilities.

**How it works:**

1. User enters a topic (e.g., "Diffusion Models").
2. A background worker spawns a **multi-round Copilot SDK session** that:
   - Searches the web for relevant sources (via the SDK's built-in capabilities)
   - Extracts `Concept` nodes and `PrerequisiteEdge` relationships using **structured tool calls**
   - Uses a **fast model tier** (`GPT-5-mini` via `FOUNDRY_FAST_DEPLOYMENT_NAME`) for high-volume
     extraction to optimize cost
   - Detects **convergence** when new-concept growth rate falls below threshold
   - Enforces a **safety budget cap** (max rounds, max tokens, wall-clock timeout)
3. Events stream to the client via **Server-Sent Events (SSE)** with `<60s` heartbeats
   (required to survive Azure App Service's 240s request timeout).
4. The client renders nodes/edges in **real-time** as they arrive — the graph literally grows
   before the user's eyes.

**Implementation files:**
- `src/lib/research/orchestrate.ts` — Multi-round agentic loop
- `src/lib/research/extract.ts` — Copilot SDK structured extraction with tool calls
- `src/lib/research/convergence.ts` — Growth-rate convergence detection
- `src/lib/research/worker.ts` — Background worker (avoids HTTP timeout)
- `src/lib/research/bus.ts` — Event bus for SSE streaming
- `src/app/api/research/stream/route.ts` — SSE endpoint

**Copilot SDK usage depth:**
- `createSession()` with BYOK Azure Foundry provider configuration
- Multi-turn conversations with context accumulation
- Structured output extraction via tool/function calling
- Streaming token delivery for real-time UX
- Dual-model strategy (GPT-5 for quality, GPT-5-mini for throughput)

### 4.2 Prerequisite Knowledge Graph (2D & 3D)

> **🏆 Criterion #5 — User Experience & Workflow Design (12%)**
>
> The graph visualization provides an **intuitive, interactive mental model** of the topic's
> concept hierarchy. Users maintain agency: they can explore, zoom, click nodes for detail,
> and see the live research progress — never a black box.

**Features:**
- **2D View** (default): Cytoscape.js with fCOSE force-directed layout. Nodes colored by
  category, edges show prerequisite direction. Click a node to see its definition and
  connected concepts in a detail sidebar.
- **3D View**: Three.js force-graph for immersive exploration of large graphs.
- **Real-time growth**: Nodes/edges animate in as the research engine discovers them.
- **DAG enforcement**: The `wouldCreateCycle()` guard rejects any edge that would break the
  directed acyclic graph invariant — the graph is always topologically sortable.

**Implementation files:**
- `src/components/graph/GraphCanvas.tsx` — 2D Cytoscape renderer
- `src/components/graph/Graph3D.tsx` — 3D force-graph renderer
- `src/components/graph/GraphView.tsx` — View switcher (2D/3D)
- `src/lib/graph/useGraphStream.ts` — SSE consumer hook
- `src/lib/graph/reducer.ts` — Graph state management

### 4.3 Adaptive Level Assessment (Pre-Lecture Gate)

> **🏆 Criterion #1 — Effective Use of Copilot SDK (25%)**
>
> The assessment system uses Copilot SDK to **dynamically generate questions** adapted to
> the specific topic's concept graph — not a static question bank. Each question probes
> whether the learner already knows specific nodes, enabling personalized lecture paths.

**Flow:**
1. After research converges, the system **mandatorily** presents 3–5 adaptive questions.
2. Questions are generated via Copilot SDK based on the discovered concept graph.
3. Each question maps to specific concept nodes in the graph.
4. Responses determine:
   - **Known-node set**: Concepts the learner already understands (skipped in lectures)
   - **Depth profile**: How deep each lecture should go (beginner/intermediate/advanced)
5. The assessment is a **hard gate** — lectures cannot be generated without completing it.

**Implementation files:**
- `src/lib/assessment/questions.ts` — Copilot SDK question generation
- `src/lib/assessment/score.ts` — Response evaluation and known-node detection
- `src/lib/assessment/apply.ts` — Apply results to user progress
- `src/components/graph/AssessmentQuiz.tsx` — Quiz UI component
- `src/app/api/assessment/route.ts` — Assessment API

### 4.4 Forward-Reference-0 Lecture Generation

> **🏆 Criterion #7 — Innovation & Originality (5%)**
>
> **This is the product's core innovation.** No existing learning platform formally guarantees
> forward-reference 0. KG-Learn enforces it as a **compile-time guard, runtime gate, and
> CI-blocking unit test** — making it a provable, not aspirational, property.

**The guarantee:** Given a knowledge graph `G` and known-concept set `K`, the lecture sequence
`L₁, L₂, ..., Lₙ` satisfies:

```
∀ Lᵢ: concepts_used(Lᵢ) ⊆ K ∪ {concept(L₁), ..., concept(Lᵢ₋₁)}
```

Every concept referenced in lecture `Lᵢ` is either already known by the learner (`K`) or was
the subject of a prior lecture in the sequence.

**How it works:**
1. `topoSort(graph)` produces a valid topological ordering of the DAG.
2. Known concepts (from assessment) are pre-populated in the "allowed" set.
3. For each lecture in topological order:
   - The Copilot SDK generates the lecture content, constrained to use only allowed concepts
   - `findForwardReferences(lecture, allowedSet, graph)` validates the output
   - If forward references are found, the lecture is **regenerated** with stricter constraints
   - The taught concept is then added to the allowed set
4. Lectures render with **rich content**: Markdown text + **Mermaid diagrams** + **KaTeX math**.

**Enforcement layers:**
- `src/lib/ontology/invariants.ts` — `findForwardReferences()` compile-time guard
- `src/lib/lectures/gate.ts` — Runtime gate that blocks invalid lectures
- `src/lib/lectures/lectures.offline.test.ts` — Unit test asserting 0 offenders on fixture graph
- `.github/workflows/deploy.yml` — **CI blocks release** if the forward-ref-0 test fails

**Implementation files:**
- `src/lib/lectures/generate.ts` — Copilot SDK lecture generation with constraints
- `src/lib/lectures/path.ts` — Topological ordering and path planning
- `src/lib/lectures/persist.ts` — Database persistence
- `src/components/graph/LecturePanel.tsx` — Single-lecture viewer
- `src/components/Lecture.tsx` — Rich content renderer (Mermaid + KaTeX)

### 4.5 AI Chat Assistant

> **🏆 Criterion #1 — Effective Use of Copilot SDK (25%)**
>
> The chat panel provides **contextual, graph-aware conversations** — the AI knows the
> learner's current position in the knowledge graph, their assessment results, and which
> lectures they've completed.

**Features:**
- Conversational AI assistant via Copilot SDK
- Context-aware: knows the user's topic, graph, and progress
- Integrated directly alongside the graph view (split-pane layout)
- Streaming responses for real-time feel

**Implementation:** `src/components/graph/ChatPanel.tsx`, `src/app/api/chat/route.ts`

### 4.6 Lectures Library

**Features:**
- Aggregated view of all lectures the user has generated across all topics
- Topic-grouped sidebar with lecture counts
- Full lecture rendering with Mermaid diagrams and KaTeX math
- Read-only review mode for study/revision

**Implementation:** `src/components/graph/LecturesLibraryPanel.tsx`, `src/app/api/lectures/route.ts`

### 4.7 My Projects

**Features:**
- Dashboard of all user's research topics with status indicators
- Quick resume: click any project to return to its graph/lectures
- Progress tracking: shows research status, assessment completion, lecture count

**Implementation:** `src/components/graph/ProjectsPanel.tsx`, `src/app/api/projects/route.ts`

### 4.8 Example Projects (Pre-Built Showcases)

**Features:**
- 4 complete example projects demonstrating the full pipeline:
  - **Diffusion Models** — 9 concepts, full research report, 9 detailed lecture notes
  - **Kalman Filters** — 8 concepts, engineering-focused prerequisite chain
  - **Byzantine Consensus** — 7 concepts, distributed systems domain
  - **Transformers** — 8 concepts, NLP/deep learning
- Each includes: interactive prerequisite graph, complete research report (with Mermaid diagrams),
  and full lecture notes (with KaTeX equations and worked examples)
- **No login required** — publicly accessible for demonstration

**Implementation:** `src/lib/examples/projects.ts`, `src/app/examples/[id]/page.tsx`

### 4.9 Authentication & Multi-User Isolation

> **🏆 Criterion #6 — Responsible AI, Security & Trust (6%)**

**Providers:**
- **Google OAuth** — Primary login for end users (branded button with Google logo)
- **Microsoft Entra ID** — Enterprise SSO option
- **Dev Login** — Development-only credential provider (auto-disabled in production)

**Security measures:**
- JWT-based sessions (`next-auth` with `strategy: "jwt"`)
- User data isolated per account (all queries scoped by `userId`)
- Secrets stored in **Azure Key Vault** (never in code or environment files)
- Key Vault references in App Service settings (`@Microsoft.KeyVault(...)`)
- OIDC federated credentials for CI (no stored secrets in GitHub)
- Production guard: `CopilotProvider` **throws** if Foundry credentials are missing in production
  — prevents silent fallback to non-Azure models
- `AUTH_SECRET` rotatable via Key Vault without redeployment

**Implementation:** `src/lib/auth/options.ts`, `src/lib/auth/current-user.ts`

---

## 5. Azure AI & Cloud Integration

> **🏆 Criterion #3 — Azure AI & Cloud Integration (18%)**
>
> KG-Learn is not "deployed to Azure" as an afterthought — it is **architecturally dependent**
> on Azure services. The AI layer runs on Azure AI Foundry, data persists in Azure PostgreSQL,
> secrets live in Azure Key Vault, and CI/CD uses Azure OIDC. Removing Azure would require
> rewriting the entire backend.

### 5.1 Azure AI Foundry (BYOK)

- **Dual-model deployment:**
  - `GPT-5` (`FOUNDRY_DEPLOYMENT_NAME`) — High-quality lectures, assessment, chat
  - `GPT-5-mini` (`FOUNDRY_FAST_DEPLOYMENT_NAME`) — Cost-efficient research extraction
- **BYOK configuration:** The Copilot SDK's `createSession()` receives a custom provider:
  ```typescript
  provider: {
    type: "openai",
    baseUrl: `${endpoint}/openai/v1/`,
    apiKey: process.env.AZURE_AI_FOUNDRY_API_KEY,
    wireApi: "responses"
  }
  ```
- **CI gate:** `/api/ai-health` endpoint verifies the live model `base_url` is an Azure Foundry
  endpoint — the deploy pipeline **fails** if it detects a non-Azure backend.

### 5.2 Azure App Service

- **Region:** Korea Central (low-latency for target users)
- **Runtime:** Node.js 22 LTS
- **Startup:** `npx next start -p 8080`
- **Configuration:** `SCM_DO_BUILD_DURING_DEPLOYMENT=false` (prebuilt zip deployment)

### 5.3 Azure Database for PostgreSQL Flexible Server

- **SKU:** Standard_B1ms, PostgreSQL 16
- **ORM:** Prisma with provider-switching script (`scripts/set-db-provider.mjs`)
- **Migrations:** Applied via `prisma migrate deploy` in CI pipeline
- **Local dev:** SQLite for zero-config development

### 5.4 Azure Key Vault

- **Managed secrets:** `DATABASE-URL`, `AZURE-AI-FOUNDRY-API-KEY`, `AUTH-SECRET`
- **App Service integration:** Key Vault references (`@Microsoft.KeyVault(SecretUri=...)`)
- **CI access:** OIDC service principal with "Key Vault Secrets User" role

### 5.5 CI/CD Pipeline (GitHub Actions + Azure OIDC)

The deployment pipeline (`.github/workflows/deploy.yml`) implements a rigorous multi-gate process:

```
Install → Set DB provider → Prisma generate → Forward-ref-0 gate (AC-9)
→ Full test suite → Typecheck → Azure OIDC login → Resolve KV secrets
→ Build (prod) → Prisma migrate → Prune + trim + zip → Deploy
→ Health gate (/api/health) → AI-health gate (Azure Foundry verified)
```

**Key features:**
- **OIDC federation** — No stored Azure credentials; federated identity via Entra app registration
- **Forward-ref-0 keystone gate** — Release is blocked if the invariant test fails
- **AI-health post-deploy gate** — Verifies the deployed app uses Azure Foundry (not GitHub-hosted models)
- **Platform-aware packaging** — Strips non-Linux platform binaries from the Copilot SDK (saves ~500MB)

---

## 6. Shared Data Contract (Ontology)

Defined in `src/lib/ontology/types.ts`; guards in `src/lib/ontology/invariants.ts`.

### 6.1 Core Types

| Type | Fields | Purpose |
|------|--------|---------|
| `Concept` | id, name, definition, category, depth | A node in the knowledge graph |
| `PrerequisiteEdge` | from, to | Directed edge: `from` is prerequisite OF `to` |
| `KnowledgeGraph` | concepts, edges, status | The full graph state |
| `GraphEvent` | type (node/edge/status), payload | SSE streaming event |
| `AssessmentQuestion` | question, conceptIds, options | Adaptive quiz item |
| `UserLevel` | knownConcepts, depthProfile | Assessment output |
| `Lecture` | conceptId, title, body, order | Generated lecture content |

### 6.2 Runtime Invariants

| Guard | Function | Enforcement |
|-------|----------|-------------|
| DAG integrity | `wouldCreateCycle(graph, edge)` | Every edge insertion |
| Topological order | `topoSort(graph)` | Lecture sequencing |
| Forward-ref-0 | `findForwardReferences(lecture, allowed, graph)` | Every lecture generation |
| Convergence | Growth rate < threshold | Research auto-stop |

---

## 7. User Experience Design

> **🏆 Criterion #5 — User Experience & Workflow Design (12%)**

### 7.1 User Flow

```
Landing Page → Google Sign-In → Enter Topic → Live Graph Growth (SSE)
→ Mandatory Assessment Quiz → "Generate Lectures" Button → Lecture Viewer
→ Lectures Library (review) → My Projects (resume)
```

### 7.2 UX Principles Applied

| Principle | Implementation |
|-----------|---------------|
| **Progressive disclosure** | Topic input → graph → quiz → lectures (one phase at a time) |
| **Visibility of system status** | Real-time graph growth, research progress indicators, streaming responses |
| **User control** | "Stop research" button, re-assess option, lecture-by-lecture pacing |
| **Error prevention** | Assessment is mandatory before lectures (prevents confusion) |
| **Recognition over recall** | Graph visualization makes prerequisite structure visible, not hidden |
| **Consistency** | Unified sidebar navigation (Graph & Chat / Lectures / My Projects / Examples) |
| **Accessibility** | Radix UI primitives (Dialog, Tooltip, Progress) with ARIA attributes |
| **Low resistance** | Google OAuth one-click login, example projects require no login |

### 7.3 Layout

- **Main workspace:** Split-pane — graph visualization (left/center) + chat panel (right)
- **Sidebar navigation:** Graph & Chat | Lectures | My Projects | Examples
- **Assessment:** Full-screen modal quiz before lecture generation
- **Lectures:** Inline panel with rich content (Mermaid + KaTeX)

---

## 8. Functionality & Technical Execution

> **🏆 Criterion #4 — Functionality & Technical Execution (16%)**

### 8.1 End-to-End Working Pipeline

| Step | Status | Verified By |
|------|--------|-------------|
| Topic input → research start | ✅ Working | Manual + offline test |
| Multi-agent web research | ✅ Working | `test:research` |
| Real-time SSE graph streaming | ✅ Working | Manual verification |
| DAG invariant enforcement | ✅ Working | `test:guards` |
| Adaptive assessment | ✅ Working | `test:assessment` |
| Forward-ref-0 lecture generation | ✅ Working | `test:lectures` (CI keystone gate) |
| Mermaid + KaTeX rendering | ✅ Working | Playwright verification |
| Multi-user persistence | ✅ Working | Prisma + PostgreSQL |
| Google OAuth login | ✅ Working | NextAuth integration |
| Azure deployment | ✅ Working | GitHub Actions CI/CD |
| Health + AI-health gates | ✅ Working | Post-deploy CI verification |

### 8.2 Code Quality

- **TypeScript strict mode** — Full type coverage, no `any` escape hatches
- **Automated test suite** — 5 test modules (guards, research, assessment, graph, lectures)
- **CI-enforced gates** — Typecheck + tests must pass before deploy
- **Prisma schema** — Type-safe database access with auto-generated client
- **Modular architecture** — Each domain (`research/`, `assessment/`, `lectures/`, `graph/`)
  is self-contained with its own types, logic, persistence, and tests

### 8.3 Error Handling

- Research convergence detection prevents infinite loops
- Safety budget cap (max rounds, tokens, wall-clock) prevents runaway costs
- SSE heartbeat `<60s` prevents Azure App Service timeout
- `CopilotProvider` throws in production without Foundry config (fail-fast)
- Prisma connection error handling with graceful degradation

---

## 9. Responsible AI, Security & Trust

> **🏆 Criterion #6 — Responsible AI, Security & Trust (6%)**

| Concern | Mitigation |
|---------|-----------|
| **AI transparency** | Graph shows exactly which concepts AI extracted; lectures cite prerequisite concepts |
| **Human-in-the-loop** | Mandatory assessment quiz before lectures; user advances one lecture at a time |
| **Hallucination mitigation** | Forward-ref-0 gate catches lectures using undefined concepts; convergence detection prevents over-extraction |
| **Data privacy** | Per-user data isolation; JWT sessions; no cross-user data leakage |
| **Secret management** | Azure Key Vault for all credentials; OIDC federation for CI (no stored secrets) |
| **Prompt injection awareness** | Copilot SDK handles prompt formatting; structured tool calls for extraction (not raw string interpolation) |
| **Production safety** | Hard fail if Foundry provider missing in production — no silent GitHub-hosted fallback |

---

## 10. Innovation & Originality

> **🏆 Criterion #7 — Innovation & Originality (5%)**

### What's genuinely new:

1. **Forward-reference 0 as a formal guarantee** — No other learning platform enforces this as
   a testable, CI-gated invariant. It transforms "good pedagogy" from a subjective goal into a
   provable property.

2. **Live-growing prerequisite graph** — Research results stream as the graph grows in real-time,
   making the AI's work transparent and engaging (not a loading spinner followed by a dump).

3. **Prerequisite-aware adaptive assessment** — Questions are generated from the actual
   discovered concept graph, not a generic question bank. The assessment directly feeds the
   lecture personalization.

4. **Dual-model cost optimization** — Using GPT-5-mini for high-volume research extraction and
   GPT-5 for quality-critical lectures/assessment demonstrates intelligent resource allocation.

5. **Multi-agent orchestration via Copilot SDK** — Research, assessment, and lecture generation
   are distinct agentic workflows, each with specialized prompts and tool configurations,
   unified through a single SDK.

---

## 11. Acceptance Criteria

| ID | Criterion | Enforcement |
|----|-----------|-------------|
| AC-1 | Topic/prompt input starts research | Manual |
| AC-2 | Extracts concepts AND prerequisite edges from web sources | `test:research` |
| AC-3 | Auto-stops on convergence; respects safety budget | `test:research` |
| AC-4 | 3–5 adaptive questions before any lecture | `test:assessment` |
| AC-5 | Assessment results feed known-node set and lecture depth | `test:assessment` |
| AC-6 | Knowledge graph is a cycle-free DAG | `test:guards` |
| AC-7 | Nodes/edges stream via SSE in real time | `test:graph` |
| AC-8 | Graph interaction: click → detail, hover, zoom | Manual |
| **AC-9** | **Forward-reference 0 (KEYSTONE)** — zero offenders on fixture graph | **`test:lectures` (CI gate)** |
| AC-10 | Lectures generated one at a time in topological order | `test:lectures` |
| AC-11 | Lectures render text + Mermaid + KaTeX | Playwright |
| AC-12 | Multi-user login with isolated persistence | Manual |
| AC-13 | Live Azure URL; `git push main` auto-deploys; health + ai-health pass | CI post-deploy gates |

---

## 12. Configuration & Deployment

### 12.1 Environment Variables

| Variable | Context | Source |
|----------|---------|--------|
| `AZURE_AI_FOUNDRY_ENDPOINT` | Prod | App Service setting |
| `AZURE_AI_FOUNDRY_API_KEY` | Prod | Key Vault reference |
| `FOUNDRY_DEPLOYMENT_NAME` | Both | `gpt-5` |
| `FOUNDRY_FAST_DEPLOYMENT_NAME` | Both | `gpt-5-mini` |
| `DATABASE_URL` | Both | Key Vault (prod) / `file:./dev.db` (dev) |
| `AUTH_SECRET` | Both | Key Vault |
| `GOOGLE_CLIENT_ID` | Both | App Service setting |
| `GOOGLE_CLIENT_SECRET` | Prod | App Service setting |
| `COPILOT_HOME` | Prod | `/tmp/copilot` |

### 12.2 Infrastructure

| Resource | Type | Region |
|----------|------|--------|
| `kglearn-web-ae541e` | App Service (B1, Node 22) | Korea Central |
| Azure PostgreSQL Flexible | Standard_B1ms, v16 | Korea Central |
| `kglearn-kv-ae541e` | Key Vault | Korea Central |
| `kglearn-foundry-ae541e` | Azure AI Foundry | East US 2 |

---

## 13. Out of Scope (v1)

- File/document uploads as research sources
- Collaborative/multi-learner shared graphs
- Mobile-native clients
- Offline mode
- Non-Azure model or hosting options
- Real-time collaborative editing
- Export to PDF/SCORM
