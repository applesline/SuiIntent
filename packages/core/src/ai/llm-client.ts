/**
 * LLMClient — Unified LLM Provider Interface
 *
 * Extracts provider-specific API calls from the AI class into a unified interface.
 * Eliminates 6 duplicate connection test methods and 6 duplicate API call methods.
 *
 * Supported providers: openai, anthropic, google, azure, deepseek, ollama
 */

import { logger } from "../core/logger.js";
import type { AIConfig, AIProvider } from "../core/types.js";

// ==================== Types ====================

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequestOptions {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "text" | "json_object" };
  functions?: Array<{
    name: string;
    description?: string;
    parameters: Record<string, any>;
  }>;
  functionCall?: "auto" | "none" | { name: string };
  /** NEW: Tools in OpenAI-compatible format for function calling */
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  }>;
  /** NEW: Tool choice strategy */
  toolChoice?: "auto" | "none" | "required";
}

export interface LLMResponse {
  text: string;
  raw: any;
  provider: AIProvider;
  model: string;
  /** NEW: Parsed tool calls from the response */
  toolCalls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

// ==================== Provider Config ====================

interface ProviderConfig {
  baseUrl: string;
  defaultModel: string;
  headers: (apiKey: string, config?: AIConfig) => Record<string, string>;
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-3.5-turbo",
    headers: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }),
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-haiku-20240307",
    headers: (apiKey) => ({
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    }),
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1",
    defaultModel: "gemini-pro",
    headers: (apiKey) => ({
      "Content-Type": "application/json",
    }),
  },
  azure: {
    baseUrl: "", // Dynamic: uses apiEndpoint
    defaultModel: "gpt-35-turbo",
    headers: (apiKey) => ({
      "api-key": apiKey,
      "Content-Type": "application/json",
    }),
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    headers: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }),
  },
  ollama: {
    baseUrl: "http://localhost:11434",
    defaultModel: "llama2",
    headers: () => ({
      "Content-Type": "application/json",
    }),
  },
};

// ==================== LLMClient Class ====================

export class LLMClient {
  private config: AIConfig | null = null;
  private providerConfig: ProviderConfig | null = null;

  /**
   * Configure the LLM client with provider settings
   */
  configure(config: AIConfig): void {
    this.config = config;

    if (config.provider === "none" || !config.provider) {
      this.providerConfig = null;
      return;
    }

    const providerCfg = PROVIDER_CONFIGS[config.provider];
    if (!providerCfg) {
      throw new Error(`Unsupported provider: ${config.provider}`);
    }

    this.providerConfig = providerCfg;
    logger.debug(`[LLMClient] Configured for provider: ${config.provider}`);
  }

  /**
   * Check if the client is configured and ready
   */
  isConfigured(): boolean {
    return (
      this.config !== null &&
      this.config.provider !== "none" &&
      this.providerConfig !== null
    );
  }

  /**
   * Get the current provider name
   */
  getProvider(): AIProvider | "none" {
    return this.config?.provider || "none";
  }

  /**
   * Get the current model name
   */
  getModel(): string {
    return this.config?.model || this.providerConfig?.defaultModel || "unknown";
  }

  /**
   * Test connection to the configured provider
   */
  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.config || !this.providerConfig) {
      return { success: false, message: "AI not configured" };
    }

    const provider = this.config.provider;
    const apiKey = this.config.apiKey;

    try {
      switch (provider) {
        case "openai":
          return this.testOpenAICompatible(apiKey!, "models");
        case "anthropic":
          return this.testAnthropic(apiKey!);
        case "google":
          return this.testGoogle(apiKey!);
        case "azure":
          return this.testAzure(apiKey!);
        case "deepseek":
          return this.testOpenAICompatible(apiKey!, "models");
        case "ollama":
          return this.testOllama();
        default:
          return {
            success: false,
            message: `Unsupported provider: ${provider}`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Connection test failed: ${error.message}`,
      };
    }
  }

  /**
   * Send a chat completion request to the configured provider
   */
  async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    if (!this.config || !this.providerConfig) {
      throw new Error(
        "AI provider not configured. Please call configure() first.",
      );
    }

    const provider = this.config.provider;
    const apiKey = this.config.apiKey;
    const model = this.getModel();

    try {
      switch (provider) {
        case "openai":
          return this.callOpenAICompatible(options, apiKey!, model);
        case "anthropic":
          return this.callAnthropic(options, apiKey!, model);
        case "google":
          return this.callGoogle(options, apiKey!, model);
        case "azure":
          return this.callAzure(options, apiKey!, model);
        case "deepseek":
          return this.callOpenAICompatible(options, apiKey!, model);
        case "ollama":
          return this.callOllama(options, model);
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }
    } catch (error: any) {
      logger.error(`[LLMClient] Chat request failed: ${error.message}`);
      throw error;
    }
  }

  // ==================== Connection Tests ====================

  private async testOpenAICompatible(
    apiKey: string,
    path: string,
  ): Promise<ConnectionTestResult> {
    const baseUrl = this.getBaseUrl();
    const response = await fetch(`${baseUrl}/${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      return {
        success: true,
        message: `${this.config!.provider} connection OK`,
      };
    }
    return {
      success: false,
      message: `API returned error: ${response.status}`,
    };
  }

  private async testAnthropic(apiKey: string): Promise<ConnectionTestResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.getModel(),
        max_tokens: 10,
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    if (response.ok) {
      return { success: true, message: "Anthropic connection OK" };
    }
    return {
      success: false,
      message: `API returned error: ${response.status}`,
    };
  }

  private async testGoogle(apiKey: string): Promise<ConnectionTestResult> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
    );

    if (response.ok) {
      return { success: true, message: "Google Gemini connection OK" };
    }
    return {
      success: false,
      message: `API returned error: ${response.status}`,
    };
  }

  private async testAzure(apiKey: string): Promise<ConnectionTestResult> {
    if (!this.config?.apiEndpoint) {
      return { success: false, message: "Missing API endpoint for Azure" };
    }
    const apiVersion = this.config.apiVersion || "2024-02-15-preview";
    const endpoint = this.config.apiEndpoint.replace(/\/$/, "");
    const url = `${endpoint}/openai/deployments?api-version=${apiVersion}`;

    const response = await fetch(url, {
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      return { success: true, message: "Azure OpenAI connection OK" };
    }
    return {
      success: false,
      message: `API returned error: ${response.status}`,
    };
  }

  private async testOllama(): Promise<ConnectionTestResult> {
    const endpoint = this.config?.apiEndpoint || "http://localhost:11434";
    const response = await fetch(`${endpoint}/api/tags`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (response.ok) {
      return { success: true, message: `Ollama connection OK (${endpoint})` };
    }
    return {
      success: false,
      message: `Ollama service error: ${response.status}`,
    };
  }

  // ==================== Chat Completion Calls ====================

  private async callOpenAICompatible(
    options: LLMRequestOptions,
    apiKey: string,
    model: string,
  ): Promise<LLMResponse> {
    const baseUrl = this.getBaseUrl();
    const requestBody: any = {
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 1024,
    };

    if (options.responseFormat) {
      requestBody.response_format = options.responseFormat;
    }
    if (options.functions && options.functions.length > 0) {
      requestBody.functions = options.functions;
      requestBody.function_call = options.functionCall || "auto";
    }
    // NEW: Support tools parameter for function calling
    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      // tool_choice: "required" forces the LLM to always use a tool call
      // This is critical for multi-step operations where the LLM must generate
      // one tool call per step (e.g., cetus_swap + navi_deposit).
      // "auto" allows the LLM to choose between text and tool calls,
      // which may cause it to skip steps.
      requestBody.tool_choice = options.toolChoice || "auto";
      // DeepSeek V4 Pro strict mode: force LLM to strictly follow tool schema
      if (options.toolChoice === "required") {
        requestBody.strict = true;
      }
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`${this.config!.provider} API error: ${response.status}`);
    }

    const raw = await response.json();
    return {
      text: raw.choices?.[0]?.message?.content || "",
      raw,
      provider: this.config!.provider,
      model,
      // NEW: Extract tool_calls from response
      toolCalls: raw.choices?.[0]?.message?.tool_calls || undefined,
    };
  }

  private async callAnthropic(
    options: LLMRequestOptions,
    apiKey: string,
    model: string,
  ): Promise<LLMResponse> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens ?? 1024,
        messages: options.messages,
        temperature: options.temperature ?? 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const raw = await response.json();
    return {
      text: raw.content?.[0]?.text || "",
      raw,
      provider: "anthropic",
      model,
    };
  }

  private async callGoogle(
    options: LLMRequestOptions,
    apiKey: string,
    model: string,
  ): Promise<LLMResponse> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: options.messages.map((msg) => ({
            parts: [{ text: msg.content }],
            role: msg.role === "user" ? "user" : "model",
          })),
          generationConfig: {
            temperature: options.temperature ?? 0.1,
            maxOutputTokens: options.maxTokens ?? 1024,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Google API error: ${response.status}`);
    }

    const raw = await response.json();
    return {
      text: raw.candidates?.[0]?.content?.parts?.[0]?.text || "",
      raw,
      provider: "google",
      model,
    };
  }

  private async callAzure(
    options: LLMRequestOptions,
    apiKey: string,
    model: string,
  ): Promise<LLMResponse> {
    const endpoint =
      this.config?.apiEndpoint || "https://YOUR_RESOURCE.openai.azure.com";
    const apiVersion = this.config?.apiVersion || "2024-02-15-preview";
    const url = `${endpoint}/openai/deployments/${model}/chat/completions?api-version=${apiVersion}`;

    const requestBody: any = {
      messages: options.messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 1024,
    };

    if (options.functions && options.functions.length > 0) {
      requestBody.functions = options.functions;
      requestBody.function_call = options.functionCall || "auto";
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Azure OpenAI API error: ${response.status}`);
    }

    const raw = await response.json();
    return {
      text: raw.choices?.[0]?.message?.content || "",
      raw,
      provider: "azure",
      model,
    };
  }

  private async callOllama(
    options: LLMRequestOptions,
    model: string,
  ): Promise<LLMResponse> {
    const endpoint = this.config?.apiEndpoint || "http://localhost:11434";
    const lastMsg = options.messages[options.messages.length - 1];

    const response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: lastMsg?.content || "",
        stream: false,
        options: {
          temperature: options.temperature ?? 0.1,
          num_predict: options.maxTokens ?? 1024,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const raw = await response.json();
    return {
      text: raw.response || "",
      raw,
      provider: "ollama",
      model,
    };
  }

  // ==================== Helpers ====================

  private getBaseUrl(): string {
    if (this.config?.apiEndpoint) {
      return this.config.apiEndpoint.replace(/\/+$/, "");
    }
    return this.providerConfig!.baseUrl;
  }
}

// Singleton instance
let defaultClient: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!defaultClient) {
    defaultClient = new LLMClient();
  }
  return defaultClient;
}
