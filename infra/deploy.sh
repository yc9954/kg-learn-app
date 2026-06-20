#!/usr/bin/env bash
# =============================================================================
# One-shot provisioning for the Knowledge-Graph Learning App (PRD §8 step 6).
#
# This script is the ONLY thing the user runs after `az login`. It:
#   1. detects the active subscription,
#   2. derives the deterministic unique suffix,
#   3. generates the Postgres admin password + AUTH_SECRET (-> Key Vault),
#   4. creates the resource group,
#   5. deploys infra/main.bicep (App Service + Postgres + Foundry + Key Vault),
#   6. creates the Entra ID app registration with the correct redirect URI and
#      writes its client id / secret into the deployment,
#   7. prints the outputs needed for the GitHub Actions workflow.
#
# It NEVER hard-codes secrets and is safe to re-run (idempotent: same suffix,
# `az deployment group create` is a PUT). Requires: az CLI (logged in), openssl.
#
# Usage:
#   ./infra/deploy.sh                 # full provision (default region koreacentral)
#   TAVILY_API_KEY=tvly-... ./infra/deploy.sh   # also wire the search key
# =============================================================================
set -euo pipefail

# ---- Fixed defaults (from infra/azure.defaults.json) ------------------------
PREFIX="kglearn"
RG="rg-kglearn"
LOCATION="koreacentral"
FOUNDRY_LOCATION="eastus2"
BICEP="$(cd "$(dirname "$0")" && pwd)/main.bicep"

# ---- 1. Subscription --------------------------------------------------------
if ! az account show >/dev/null 2>&1; then
  echo "ERROR: not logged in. Run 'az login' first." >&2
  exit 1
fi
SUB_ID="$(az account show --query id -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"
echo ">> Subscription: $SUB_ID"
echo ">> Tenant:       $TENANT_ID"

# ---- 2. Deterministic suffix (lowercase 6-char hash of the subscription id)--
SUFFIX="$(printf '%s' "$SUB_ID" | shasum -a 256 | cut -c1-6 | tr '[:upper:]' '[:lower:]')"
WEBAPP="${PREFIX}-web-${SUFFIX}"
WEBHOST="${WEBAPP}.azurewebsites.net"
REDIRECT_URI="https://${WEBHOST}/api/auth/callback/microsoft-entra-id"
echo ">> Unique suffix: $SUFFIX"
echo ">> Web app:       $WEBAPP"

# ---- 3. Generate secrets (never printed in full) ----------------------------
PG_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)Aa1!"
AUTH_SECRET="$(openssl rand -base64 32)"
TAVILY_API_KEY="${TAVILY_API_KEY:-}"   # optional; placeholder in Key Vault if empty

# ---- 4. Entra ID app registration -------------------------------------------
# Created BEFORE the infra deployment so its client id/secret flow into Key Vault.
ENTRA_CLIENT_ID=""
ENTRA_CLIENT_SECRET=""
ENTRA_ISSUER="https://login.microsoftonline.com/${TENANT_ID}/v2.0"
if ENTRA_CLIENT_ID="$(az ad app create --display-name "kg-learn-${SUFFIX}" \
      --web-redirect-uris "$REDIRECT_URI" \
      --query appId -o tsv 2>/dev/null)"; then
  ENTRA_CLIENT_SECRET="$(az ad app credential reset --id "$ENTRA_CLIENT_ID" \
      --display-name kg-learn-secret --query password -o tsv)"
  echo ">> Entra app registered: $ENTRA_CLIENT_ID  (redirect: $REDIRECT_URI)"
else
  echo "WARNING: could not create the Entra app registration (insufficient" \
       "directory permissions). Deploying without it; wire AUTH_MICROSOFT_ENTRA_ID_*" \
       "manually or fall back to GitHub OAuth. See infra/README.md." >&2
fi

# ---- 5. Resource group + deployment -----------------------------------------
echo ">> Creating resource group $RG in $LOCATION ..."
az group create -n "$RG" -l "$LOCATION" -o none

echo ">> Deploying infrastructure (this provisions Postgres + Foundry; ~10-15 min) ..."
az deployment group create \
  --resource-group "$RG" \
  --name "kglearn-$(date +%Y%m%d%H%M%S)" \
  --template-file "$BICEP" \
  --parameters \
      namePrefix="$PREFIX" \
      uniqueSuffix="$SUFFIX" \
      location="$LOCATION" \
      foundryLocation="$FOUNDRY_LOCATION" \
      postgresAdminPassword="$PG_PASSWORD" \
      authSecret="$AUTH_SECRET" \
      tavilyApiKey="$TAVILY_API_KEY" \
      entraClientId="$ENTRA_CLIENT_ID" \
      entraClientSecret="$ENTRA_CLIENT_SECRET" \
      entraIssuer="$ENTRA_ISSUER" \
  -o none

LAST_DEPLOYMENT="$(az deployment group list -g "$RG" --query "[?starts_with(name, 'kglearn-')]|sort_by(@,&properties.timestamp)[-1].name" -o tsv)"
WEBURL="$(az deployment group show -g "$RG" -n "$LAST_DEPLOYMENT" --query "properties.outputs.webAppUrl.value" -o tsv)"
FOUNDRY_ENDPOINT="$(az deployment group show -g "$RG" -n "$LAST_DEPLOYMENT" --query "properties.outputs.foundryEndpoint.value" -o tsv)"
KV_NAME="$(az deployment group show -g "$RG" -n "$LAST_DEPLOYMENT" --query "properties.outputs.keyVaultName.value" -o tsv)"

echo ""
echo "============================================================"
echo " PROVISION COMPLETE"
echo "============================================================"
echo " Public URL        : $WEBURL"
echo " Health            : $WEBURL/api/health"
echo " AI health         : $WEBURL/api/ai-health"
echo " Foundry endpoint  : $FOUNDRY_ENDPOINT"
echo " Key Vault         : $KV_NAME"
echo " Entra redirect    : $REDIRECT_URI"
echo ""
echo " Next: set GitHub repo secrets/vars (see infra/README.md), then push to"
echo " main — the deploy.yml workflow builds, migrates, deploys, and runs the"
echo " forward-ref-0 + ai-health gates."
echo "============================================================"
