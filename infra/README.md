# Azure deployment — Knowledge-Graph Learning App

Everything needed to take the app from local to a public, multi-user Azure
deployment with GitHub Actions CI/CD. Defaults come from
[`azure.defaults.json`](./azure.defaults.json) and are pre-decided — the only
interactive step is `az login`, and the only user-supplied secret is
`TAVILY_API_KEY`.

## What gets provisioned (`main.bicep`)

| Resource | SKU / config | Purpose |
|---|---|---|
| App Service Plan `asp-kglearn` | Linux **B1** | Hosts the web app (Always On) |
| Web App `kglearn-web-<suffix>` | Node **22-lts**, Always On, WebSockets, `npx next start -p 8080`, `WEBSITES_PORT=8080`, healthCheckPath `/api/health` | The Next.js app |
| PostgreSQL Flexible `kglearn-pg-<suffix>` | **Standard_B1ms** (Burstable), **v16**, 32 GB, db `kglearn` | Production DB (per-user data) |
| Azure AI Foundry `kglearn-foundry-<suffix>` | AIServices **S0** (in `eastus2`) | BYOK model backend |
| ↳ deployment `gpt-5` | GlobalStandard, cap 50 | `FOUNDRY_DEPLOYMENT_NAME` (lectures, assessment) |
| ↳ deployment `gpt-5-mini` | GlobalStandard, cap 80 | `FOUNDRY_FAST_DEPLOYMENT_NAME` (research extraction) |
| Key Vault `kglearn-kv-<suffix>` | RBAC | Holds every secret; App Settings reference it |

`<suffix>` = lowercase 6-char hash of the subscription id (deterministic, so the
script is idempotent). All resources go in resource group **`rg-kglearn`**.

### App Settings wired by the Bicep (no plaintext secrets)
`AZURE_AI_FOUNDRY_ENDPOINT`, `AZURE_AI_FOUNDRY_API_KEY` (KV ref),
`FOUNDRY_DEPLOYMENT_NAME`, `FOUNDRY_FAST_DEPLOYMENT_NAME`, `COPILOT_HOME=/tmp/copilot`,
`DATABASE_URL` (KV ref), `AUTH_SECRET` (KV ref), `AUTH_URL`, `AUTH_TRUST_HOST`,
`AUTH_MICROSOFT_ENTRA_ID_ID/_SECRET (KV ref)/_ISSUER`, `TAVILY_API_KEY` (KV ref),
`WEBSITES_PORT=8080`, `NODE_ENV=production`.

> **Never set** `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` — they would
> route the Copilot SDK to non-Azure GitHub-hosted models. They are deliberately
> absent, and `/api/ai-health` blocks the release if a non-Azure backend resolves.

### Key Vault secrets
`AZURE-AI-FOUNDRY-API-KEY` (derived from the Foundry account at deploy),
`DATABASE-URL`, `AUTH-SECRET`, `TAVILY-API-KEY`,
`AUTH-MICROSOFT-ENTRA-ID-SECRET`.

## Validate offline (no login)
```bash
az bicep build --file infra/main.bicep
```

## Provision (one command, after login)
```bash
az login                       # the ONE interactive step
export TAVILY_API_KEY=tvly-... # optional; omit to deploy with a placeholder
./infra/deploy.sh
```
`deploy.sh` detects the subscription, derives the suffix, generates the Postgres
password + `AUTH_SECRET`, registers the Entra app (redirect
`https://<webapp-host>/api/auth/callback/microsoft-entra-id`), then runs
`az deployment group create` and prints the public URL + health endpoints.

## CI/CD — GitHub Actions (`.github/workflows/deploy.yml`)
Push to `main` →  install → flip Prisma to PostgreSQL → **forward-ref-0 keystone
gate (AC-9)** + full tests → typecheck → OIDC login → resolve secrets from Key
Vault → `next build` → `prisma migrate deploy` → zip-deploy → **health gate** →
**ai-health gate** (asserts the live model `base_url` is the Azure Foundry
endpoint; fails on any GitHub-hosted / non-Azure backend).

### Required GitHub **secrets**
| Secret | Value |
|---|---|
| `AZURE_CLIENT_ID` | App (client) id of the OIDC service principal |
| `AZURE_TENANT_ID` | Directory (tenant) id |
| `AZURE_SUBSCRIPTION_ID` | Subscription id |

### Required GitHub **variables**
| Variable | Value |
|---|---|
| `AZURE_RESOURCE_GROUP` | `rg-kglearn` |
| `AZURE_WEBAPP_NAME` | `kglearn-web-<suffix>` (from `deploy.sh` output) |
| `AZURE_KEYVAULT_NAME` | `kglearn-kv-<suffix>` |
| `FOUNDRY_DEPLOYMENT_NAME` | `gpt-5` |
| `FOUNDRY_FAST_DEPLOYMENT_NAME` | `gpt-5-mini` |

### One-time OIDC setup (federated credential)
```bash
# Create an app + service principal for GitHub Actions
appId=$(az ad app create --display-name "kg-learn-cicd" --query appId -o tsv)
az ad sp create --id "$appId"
# Federated credential for pushes to main
az ad app federated-credential create --id "$appId" --parameters '{
  "name": "gh-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<OWNER>/<REPO>:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
# Grant deploy + Key Vault read on the resource group / vault
SUB=$(az account show --query id -o tsv)
az role assignment create --assignee "$appId" --role "Website Contributor" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-kglearn"
az role assignment create --assignee "$appId" --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUB/resourceGroups/rg-kglearn/providers/Microsoft.KeyVault/vaults/kglearn-kv-<suffix>"
```
Set `AZURE_CLIENT_ID=$appId`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` as repo
secrets.

## Auth (AC-12)
- Provider: **Microsoft Entra ID** via Auth.js/NextAuth v4
  (`src/lib/auth/options.ts`). Callback URI:
  `https://<webapp-host>/api/auth/callback/microsoft-entra-id` (set by `deploy.sh`).
- Per-user isolation: on sign-in the user is upserted into our `User` table and
  the local `User.id` is stamped into the JWT (`token.sub`) and exposed as
  `session.user.id`. `getCurrentUserId()` reads it, so every `Topic` /
  `UserProgress` / `AssessmentResult` is keyed to the signed-in user. In
  production, requests without a session are rejected.
- If you lack Entra app-registration permission, register a GitHub OAuth app
  instead and set the matching `AUTH_GITHUB_*` env (one manual step).

## Manual steps (ordered)
1. `az login`
2. *(optional)* `export TAVILY_API_KEY=...` so web search works on first deploy
3. `./infra/deploy.sh` — provisions everything, prints the URL + `<suffix>`
4. Create the CI OIDC app + federated credential + role assignments (above)
5. Set the GitHub **secrets** and **variables** (tables above)
6. `git push` to `main` → CI builds, migrates, deploys, runs the gates → live URL

## Compute choice
**Azure App Service** (B1, Always On) is the default: the Copilot SDK runtime
spawns in-process, `COPILOT_HOME=/tmp/copilot` is per-instance local temp, and
Always On + the `/api/health` warmup avoid cold-start spawn failures. If
`/api/ai-health` ever fails the in-process spawn, fall back to **Azure Container
Apps** running the Copilot CLI as a TCP sidecar with an Azure Files volume for
`COPILOT_HOME` (still Azure) — see `azure.defaults.json` `compute.fallback`.
