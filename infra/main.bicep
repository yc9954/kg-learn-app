// =============================================================================
// Knowledge-Graph Learning App — Azure infrastructure (PRD §3/§4, AC-12/13).
//
// Provisions, in ONE deployment, everything the app needs:
//   - App Service Plan (Linux, B1) + Web App (Node 22, Always On, WebSockets)
//   - Azure Database for PostgreSQL Flexible Server (Burstable B1ms, v16) + db
//   - Azure AI Foundry (Cognitive Services / AIServices, S0) + TWO model
//     deployments: gpt-5 (quality) and gpt-5-mini (fast) — the BYOK backend.
//   - Key Vault holding every secret; App Settings reference KV (no plaintext).
//
// HARD CONSTRAINTS baked in (PRD §4):
//   - COPILOT_HOME = /tmp/copilot (per-instance local temp, never a share).
//   - NO COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN in app settings.
//   - The Copilot SDK BYOK provider env (endpoint/key/deployments) is wired.
//   - Production Postgres only; SQLite is never deployed.
//
// Secrets are PARAMETERS (secure) or derived at deploy time (Foundry key via
// listKeys). Nothing secret is hard-coded. Validate offline with:
//     az bicep build --file infra/main.bicep
// Deploy (after `az login`) via infra/deploy.sh.
// =============================================================================

targetScope = 'resourceGroup'

// ---- Naming / location ------------------------------------------------------
@description('Lowercase prefix for all resources.')
param namePrefix string = 'kglearn'

@description('Deterministic 6-char suffix appended to globally-unique names. Default = lowercase 6-char hash of the subscription id.')
param uniqueSuffix string = toLower(take(uniqueString(subscription().id), 6))

@description('Region for hosting resources (App Service, Postgres, Key Vault).')
param location string = 'koreacentral'

@description('Region for Azure AI Foundry / Azure OpenAI (broad model availability).')
param foundryLocation string = 'eastus2'

// ---- App Service ------------------------------------------------------------
@description('App Service Plan SKU. B1 supports Always On (needed so the Copilot CLI runtime does not cold-start-fail).')
param appServicePlanSku string = 'B1'

@description('Linux Node runtime for the Web App.')
param nodeVersion string = 'NODE|22-lts'

@description('HTTP port Next.js listens on (matches startup command and WEBSITES_PORT).')
param appPort string = '8080'

// ---- PostgreSQL -------------------------------------------------------------
param postgresSkuName string = 'Standard_B1ms'
param postgresSkuTier string = 'Burstable'
param postgresVersion string = '16'
param postgresStorageGb int = 32
param postgresDatabaseName string = 'kglearn'
param postgresAdminUser string = 'kgadmin'

@secure()
@description('Postgres admin password. Generated at deploy time (32+ chars) — never hard-coded.')
param postgresAdminPassword string

// ---- Azure AI Foundry -------------------------------------------------------
param foundryAccountName string = 'kglearn-foundry'
param foundrySku string = 'S0'

@description('Quality-tier model + deployment name (lectures, assessment) — FOUNDRY_DEPLOYMENT_NAME.')
param foundryModel string = 'gpt-5'
param foundryDeploymentName string = 'gpt-5'
@description('Quality model version. Empty = service default (latest available in-region).')
param foundryModelVersion string = ''
param foundryCapacity int = 50

@description('Fast/cost-tier model + deployment name (high-volume research extraction) — FOUNDRY_FAST_DEPLOYMENT_NAME.')
param foundryFastModel string = 'gpt-5-mini'
param foundryFastDeploymentName string = 'gpt-5-mini'
param foundryFastModelVersion string = ''
param foundryFastCapacity int = 80

// ---- Auth.js / Entra --------------------------------------------------------
@secure()
@description('Auth.js secret (openssl rand -base64 32). Generated at deploy.')
param authSecret string

@description('Entra ID application (client) id for the OAuth provider. Empty until the app registration is created.')
param entraClientId string = ''

@secure()
@description('Entra ID client secret. Empty until the app registration is created.')
param entraClientSecret string = ''

@description('Entra issuer URL, e.g. https://login.microsoftonline.com/<tenant>/v2.0')
param entraIssuer string = ''

// ---- Web search -------------------------------------------------------------
@secure()
@description('OPTIONAL Tavily web-search key (enrichment only). Empty = placeholder; research works without it via the Copilot SDK.')
param tavilyApiKey string = ''

// ---- Object id that should administer Key Vault (optional; e.g. the deployer)
@description('Optional AAD object id to grant Key Vault Secrets Officer (so the deployer can read/rotate). Empty = skip.')
param adminObjectId string = ''

// =============================================================================
// Derived names
// =============================================================================
var planName = 'asp-${namePrefix}'
var webAppName = '${namePrefix}-web-${uniqueSuffix}'
var keyVaultName = '${namePrefix}-kv-${uniqueSuffix}'
var postgresName = '${namePrefix}-pg-${uniqueSuffix}'
var foundryName = '${foundryAccountName}-${uniqueSuffix}'

// =============================================================================
// Azure AI Foundry (Cognitive Services / AIServices) + two deployments
// =============================================================================
resource foundry 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: foundryName
  location: foundryLocation
  kind: 'AIServices'
  sku: {
    name: foundrySku
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: foundryName
    publicNetworkAccess: 'Enabled'
  }
}

// Quality tier (gpt-5) — FOUNDRY_DEPLOYMENT_NAME.
resource foundryQualityDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundry
  name: foundryDeploymentName
  sku: {
    name: 'GlobalStandard'
    capacity: foundryCapacity
  }
  properties: {
    model: empty(foundryModelVersion)
      ? {
          format: 'OpenAI'
          name: foundryModel
        }
      : {
          format: 'OpenAI'
          name: foundryModel
          version: foundryModelVersion
        }
  }
}

// Fast tier (gpt-5-mini) — FOUNDRY_FAST_DEPLOYMENT_NAME.
// Chained after the quality deployment: a Foundry account rejects parallel
// deployment creation.
resource foundryFastDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundry
  name: foundryFastDeploymentName
  dependsOn: [
    foundryQualityDeployment
  ]
  sku: {
    name: 'GlobalStandard'
    capacity: foundryFastCapacity
  }
  properties: {
    model: empty(foundryFastModelVersion)
      ? {
          format: 'OpenAI'
          name: foundryFastModel
        }
      : {
          format: 'OpenAI'
          name: foundryFastModel
          version: foundryFastModelVersion
        }
  }
}

// =============================================================================
// PostgreSQL Flexible Server + database + firewall (allow Azure services)
// =============================================================================
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  sku: {
    name: postgresSkuName
    tier: postgresSkuTier
  }
  properties: {
    version: postgresVersion
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: postgresStorageGb
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: postgresDatabaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Allow other Azure services (incl. App Service outbound) to reach Postgres.
resource postgresAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// Production connection string (sslmode=require). Stored in Key Vault.
var databaseUrl = 'postgresql://${postgresAdminUser}:${postgresAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/${postgresDatabaseName}?sslmode=require'

// =============================================================================
// Key Vault (RBAC) + secrets
// =============================================================================
resource keyVault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

resource secretFoundryKey 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: keyVault
  name: 'AZURE-AI-FOUNDRY-API-KEY'
  properties: {
    value: foundry.listKeys().key1
  }
}

resource secretDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: keyVault
  name: 'DATABASE-URL'
  properties: {
    value: databaseUrl
  }
}

resource secretAuthSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: keyVault
  name: 'AUTH-SECRET'
  properties: {
    value: authSecret
  }
}

resource secretTavily 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: keyVault
  name: 'TAVILY-API-KEY'
  properties: {
    // Placeholder when not supplied; research 401s until filled (PRD §10).
    value: empty(tavilyApiKey) ? 'REPLACE_ME_TAVILY_API_KEY' : tavilyApiKey
  }
}

resource secretEntraClientSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: keyVault
  name: 'AUTH-MICROSOFT-ENTRA-ID-SECRET'
  properties: {
    value: empty(entraClientSecret) ? 'REPLACE_ME_ENTRA_CLIENT_SECRET' : entraClientSecret
  }
}

// =============================================================================
// App Service Plan + Web App
// =============================================================================
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  sku: {
    name: appServicePlanSku
  }
  kind: 'linux'
  properties: {
    reserved: true // Linux
  }
}

var foundryEndpoint = 'https://${foundryName}.openai.azure.com'
var kvRef = '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/'

resource webApp 'Microsoft.Web/sites@2024-04-01' = {
  name: webAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: nodeVersion
      alwaysOn: true
      webSocketsEnabled: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appCommandLine: 'npx next start -p ${appPort}'
      healthCheckPath: '/api/health'
      appSettings: [
        // --- Runtime / Next.js ---
        { name: 'WEBSITES_PORT', value: appPort }
        { name: 'PORT', value: appPort }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '22-lts' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'WEBSITES_CONTAINER_START_TIME_LIMIT', value: '600' }

        // --- Copilot SDK runtime (PRD §4.5): per-instance LOCAL temp ---
        { name: 'COPILOT_HOME', value: '/tmp/copilot' }

        // --- Azure AI Foundry BYOK backend (PRD §4.2) ---
        { name: 'AZURE_AI_FOUNDRY_ENDPOINT', value: foundryEndpoint }
        { name: 'AZURE_AI_FOUNDRY_API_KEY', value: '${kvRef}${secretFoundryKey.name})' }
        { name: 'FOUNDRY_DEPLOYMENT_NAME', value: foundryDeploymentName }
        { name: 'FOUNDRY_FAST_DEPLOYMENT_NAME', value: foundryFastDeploymentName }

        // --- Database (prod Postgres) ---
        { name: 'DATABASE_URL', value: '${kvRef}${secretDatabaseUrl.name})' }

        // --- Auth.js + Entra ID ---
        { name: 'AUTH_SECRET', value: '${kvRef}${secretAuthSecret.name})' }
        { name: 'AUTH_TRUST_HOST', value: 'true' }
        { name: 'AUTH_URL', value: 'https://${webAppName}.azurewebsites.net' }
        { name: 'AUTH_MICROSOFT_ENTRA_ID_ID', value: entraClientId }
        { name: 'AUTH_MICROSOFT_ENTRA_ID_SECRET', value: '${kvRef}${secretEntraClientSecret.name})' }
        { name: 'AUTH_MICROSOFT_ENTRA_ID_ISSUER', value: entraIssuer }

        // --- Web search (research-engine) ---
        { name: 'TAVILY_API_KEY', value: '${kvRef}${secretTavily.name})' }

        // NOTE: COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN are DELIBERATELY
        // ABSENT — they would route the SDK to non-Azure GitHub-hosted models.
      ]
    }
  }
}

// =============================================================================
// RBAC: let the Web App's managed identity read Key Vault secrets
// =============================================================================
@description('Built-in role: Key Vault Secrets User')
var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
@description('Built-in role: Key Vault Secrets Officer')
var kvSecretsOfficerRoleId = 'b86a8fe4-44ce-4948-aa1f-9c2a1f1cd2f0'

resource webAppKvAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, webApp.id, kvSecretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource adminKvAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(adminObjectId)) {
  scope: keyVault
  name: guid(keyVault.id, adminObjectId, kvSecretsOfficerRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsOfficerRoleId)
    principalId: adminObjectId
  }
}

// =============================================================================
// Outputs (consumed by deploy.sh + the GitHub Actions workflow)
// =============================================================================
output webAppName string = webAppName
output webAppHost string = '${webAppName}.azurewebsites.net'
output webAppUrl string = 'https://${webAppName}.azurewebsites.net'
output entraRedirectUri string = 'https://${webAppName}.azurewebsites.net/api/auth/callback/microsoft-entra-id'
output keyVaultName string = keyVaultName
output foundryEndpoint string = foundryEndpoint
output foundryName string = foundryName
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
output resourceGroup string = resourceGroup().name
output uniqueSuffix string = uniqueSuffix
