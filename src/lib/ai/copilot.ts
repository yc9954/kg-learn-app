/**
 * CopilotProvider — the ONE and ONLY file in this app that imports the GitHub
 * Copilot SDK (PRD §4.1). Every planning / generation / agentic call in the
 * suite goes through this wrapper; no other module may import
 * `@github/copilot-sdk` or any other vendor AI SDK.
 *
 * Hard constraints enforced here (PRD §4):
 *  - Model backend = Azure AI Foundry via BYOK. Every createSession passes a
 *    provider {type:"openai", baseUrl:".../openai/v1/", apiKey, wireApi:"responses"}
 *    plus a required `model` = the Foundry deployment name. `type` is "openai"
 *    (the Foundry /openai/v1/ shape), NOT "azure".
 *  - Two model tiers: "quality" (default, FOUNDRY_DEPLOYMENT_NAME = gpt-5) and
 *    "fast" (FOUNDRY_FAST_DEPLOYMENT_NAME = gpt-5-mini, for high-volume research
 *    extraction). Fast falls back to quality if its env var is unset.
 *  - Production guard: if NODE_ENV==="production" and no Foundry provider is
 *    configured, THROW. Never let the SDK silently use GitHub-hosted models.
 *  - COPILOT_HOME / baseDirectory points at per-instance local temp, never
 *    $HOME or a networked share.
 *
 * NOTE: `generate` / `stream` / `runAgent` are OUR wrapper method names. The
 * underlying SDK surface used here is verified against @github/copilot-sdk
 * v1.0.x: CopilotClient, createSession, session.send/sendAndWait, session.on,
 * defineTool, approveAll.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  CopilotClient,
  RuntimeConnection,
  approveAll,
  defineTool,
  type ProviderConfig,
  type SessionConfig,
  type Tool,
} from "@github/copilot-sdk";

export type ModelTier = "quality" | "fast";

export type CallOptions = {
  /** Pick the model tier; "quality" (default) or "fast" for high-volume work. */
  tier?: ModelTier;
  /** Raw model/deployment override; wins over `tier`. */
  model?: string;
  /** System message / instructions prepended to the session. */
  system?: string;
};

export type AgentToolSpec<T = unknown> = {
  name: string;
  description: string;
  /** A Zod schema or a JSON-schema-like record describing the tool parameters. */
  parameters: unknown;
  handler: (args: T) => unknown | Promise<unknown>;
};

/** Resolve the per-instance COPILOT_HOME (local temp, never $HOME/networked share). */
function resolveCopilotHome(): string {
  const home =
    process.env.COPILOT_HOME && process.env.COPILOT_HOME.trim().length > 0
      ? process.env.COPILOT_HOME
      : path.join(os.tmpdir(), "kglearn-copilot");
  try {
    fs.mkdirSync(home, { recursive: true });
  } catch {
    /* best-effort; the runtime will surface a clear error if unwritable */
  }
  return home;
}

/** Resolve a deterministic local Copilot runtime path (avoids Next.js path issues). */
function resolveCopilotCliPath(): string {
  if (process.env.COPILOT_CLI_PATH?.trim()) return process.env.COPILOT_CLI_PATH.trim();
  return path.join(process.cwd(), "node_modules", "@github", "copilot", "index.js");
}

/**
 * Normalize the Azure AI Foundry endpoint to the `/openai/v1/` shape the SDK's
 * openai provider expects. Accepts the bare account endpoint or any partial form.
 */
function normalizeFoundryBaseUrl(endpoint: string): string {
  let url = endpoint.trim().replace(/\/+$/, "");
  if (!/\/openai\/v1$/.test(url)) {
    // strip any trailing /openai or /openai/v1 fragments then append canonical
    url = url.replace(/\/openai(\/v1)?$/, "");
    url = `${url}/openai/v1`;
  }
  return `${url}/`;
}

/**
 * Build the BYOK provider config, or return null when no Foundry endpoint/key
 * is configured (dev-only path — SDK falls back to GitHub-hosted models).
 */
function buildFoundryProvider(): ProviderConfig | null {
  const endpoint = process.env.AZURE_AI_FOUNDRY_ENDPOINT;
  const apiKey = process.env.AZURE_AI_FOUNDRY_API_KEY;
  if (!endpoint || !apiKey) return null;
  return {
    type: "openai",
    baseUrl: normalizeFoundryBaseUrl(endpoint),
    apiKey,
    wireApi: "responses",
  };
}

/** Resolve the deployment/model name for a tier. */
function resolveModel(tier: ModelTier, override?: string): string | undefined {
  if (override) return override;
  const quality = process.env.FOUNDRY_DEPLOYMENT_NAME;
  const fast = process.env.FOUNDRY_FAST_DEPLOYMENT_NAME;
  if (tier === "fast") return fast || quality;
  return quality;
}

class CopilotProviderImpl {
  private client: CopilotClient | null = null;
  private startPromise: Promise<void> | null = null;
  private readonly foundry: ProviderConfig | null;

  constructor() {
    this.foundry = buildFoundryProvider();

    // PRD §4.4 — production must never silently fall back to GitHub-hosted models.
    if (process.env.NODE_ENV === "production" && !this.foundry) {
      throw new Error(
        "[CopilotProvider] Refusing to start in production without an Azure AI " +
          "Foundry provider. Set AZURE_AI_FOUNDRY_ENDPOINT and " +
          "AZURE_AI_FOUNDRY_API_KEY (BYOK). The GitHub-token fallback serves " +
          "non-Azure GitHub-hosted models and is dev-only.",
      );
    }
  }

  /** Server-side singleton CLI runtime; started lazily exactly once. */
  private async getClient(): Promise<CopilotClient> {
    if (this.client) return this.client;
    if (!this.startPromise) {
      const client = new CopilotClient({
        connection: RuntimeConnection.forStdio({ path: resolveCopilotCliPath() }),
        baseDirectory: resolveCopilotHome(),
        env: { ...process.env, COPILOT_HOME: resolveCopilotHome() },
      });
      this.startPromise = client.start().then(() => {
        this.client = client;
      });
    }
    await this.startPromise;
    return this.client!;
  }

  /** Common session config: always wires BYOK provider + tiered model. */
  private sessionConfig(opts: CallOptions, extra?: Partial<SessionConfig>): SessionConfig {
    const tier: ModelTier = opts.tier ?? "quality";
    const model = resolveModel(tier, opts.model);
    const config: SessionConfig = {
      clientName: "kg-learn",
      onPermissionRequest: approveAll,
      ...extra,
    } as SessionConfig;
    if (this.foundry) config.provider = this.foundry;
    if (model) config.model = model;
    if (opts.system) {
      config.systemMessage = { mode: "append", content: opts.system };
    }
    return config;
  }

  /** Single-shot generation: send a prompt, return the assistant's text. */
  async generate(prompt: string, opts: CallOptions = {}): Promise<string> {
    const client = await this.getClient();
    const session = await client.createSession(this.sessionConfig(opts));
    try {
      const result = await session.sendAndWait({ prompt });
      return result?.data.content ?? "";
    } finally {
      await session.disconnect();
    }
  }

  /**
   * Streaming generation: invokes `onDelta` for each incremental chunk and
   * resolves with the full concatenated text when the session goes idle.
   */
  async stream(
    prompt: string,
    onDelta: (chunk: string) => void,
    opts: CallOptions = {},
  ): Promise<string> {
    const client = await this.getClient();
    const session = await client.createSession(this.sessionConfig(opts));
    let full = "";
    const off = session.on("assistant.message_delta", (event) => {
      const chunk = event.data.deltaContent ?? "";
      full += chunk;
      if (chunk) onDelta(chunk);
    });
    try {
      const result = await session.sendAndWait({ prompt });
      // Prefer the authoritative final content if present.
      return result?.data.content ?? full;
    } finally {
      off();
      await session.disconnect();
    }
  }

  /**
   * Agentic loop: register tools (declared with the SDK's defineTool) and let
   * the model call them, driving the tool.execution_start / assistant.message /
   * session.idle event loop. Returns the final assistant text.
   *
   * NOTE: "runAgent" is OUR wrapper name — there is no runAgent SDK method.
   */
  async runAgent(
    prompt: string,
    tools: AgentToolSpec[],
    opts: CallOptions = {},
  ): Promise<string> {
    const client = await this.getClient();
    const sdkTools: Tool[] = tools.map((t) =>
      defineTool(t.name, {
        description: t.description,
        // Accepts a Zod schema or a JSON-schema record per defineTool's contract.
        parameters: t.parameters as never,
        handler: async (args) => t.handler(args),
      }),
    );
    const session = await client.createSession(
      this.sessionConfig(opts, { tools: sdkTools }),
    );
    try {
      const result = await session.sendAndWait({ prompt });
      return result?.data.content ?? "";
    } finally {
      await session.disconnect();
    }
  }

  /** Whether a real Azure Foundry BYOK provider is wired (used by ai-health). */
  isFoundryConfigured(): boolean {
    return this.foundry !== null;
  }

  /** The live model base_url (for the ai-health probe in AC-13). */
  foundryBaseUrl(): string | null {
    return this.foundry?.baseUrl ?? null;
  }

  /** Graceful shutdown (e.g. on worker exit). */
  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = null;
      this.startPromise = null;
    }
  }
}

// Module-level singleton across HMR / route invocations.
const globalForCopilot = globalThis as unknown as {
  __kgCopilotProvider?: CopilotProviderImpl;
};

export const CopilotProvider: CopilotProviderImpl =
  globalForCopilot.__kgCopilotProvider ??
  (globalForCopilot.__kgCopilotProvider = new CopilotProviderImpl());

export type { CopilotProviderImpl };
