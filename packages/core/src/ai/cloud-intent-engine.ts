/**
 * Cloud LLM Intent Engine
 * Cloud LLM-based intent parsing and MCP capability auto-mapping engine
 *
 * Core capabilities:
 * 1. Plan: Generate a tool execution plan (DAG) from a user query using LLM function calling
 * 2. Confirm: Validate and confirm the plan with user interaction
 * 3. Execute: Execute steps in dependency order with variable substitution
 *
 * This replaces the old parseIntent + selectTools + executeWorkflowWithTracking pipeline.
 * - Old: 2 LLM calls (text prompt parseIntent + text prompt selectTools) + 5-layer fallback
 * - New: 1 LLM call (function calling) directly generates the plan with tool + params
 */

import { logger } from "../core/logger.js";
import { LLMClient, getLLMClient } from "./llm-client.js";
import type { AIConfig } from "../core/types.js";
import type { Tool } from "../mcp/types.js";
import { ParameterMapper, ValidationLevel } from "../mcp/parameter-mapper.js";
import { Timeouts, LLMDefaults } from "../core/constants.js";
import type {
  LLMMessage,
  LLMResponse as LLMClientResponse,
} from "./llm-client.js";

// ==================== Plan-then-Execute Types ====================

/**
 * A single step in a tool execution plan
 */
export interface PlanStep {
  /** Unique step ID (e.g., "step_1", "step_2") */
  id: string;
  /** Tool name to execute */
  toolName: string;
  /** Server name that provides this tool */
  serverName?: string;
  /** Human-readable description of what this step does */
  description: string;
  /** Parameters for the tool call */
  arguments: Record<string, unknown>;
  /** IDs of steps that this step depends on */
  dependsOn: string[];
}

/**
 * A complete tool execution plan (DAG)
 */
export interface ToolExecutionPlan {
  /** Unique plan ID */
  id: string;
  /** Original user query */
  query: string;
  /** Steps to execute in order */
  steps: PlanStep[];
  /** Whether the plan was confirmed by the user */
  confirmed: boolean;
  /** Timestamp when the plan was created */
  createdAt: Date;
  /** Timestamp when the plan was confirmed (if confirmed) */
  confirmedAt?: Date;
  /** Human-readable summary of the plan */
  summary: string;
}

/**
 * Plan execution result
 */
export interface PlanExecutionResult {
  /** Whether all steps executed successfully */
  success: boolean;
  /** Plan that was executed */
  plan: ToolExecutionPlan;
  /** Results for each step */
  stepResults: Array<{
    stepId: string;
    toolName: string;
    success: boolean;
    result?: unknown;
    error?: string;
    duration: number;
  }>;
  /** Final result (output of the last step) */
  finalResult?: unknown;
  /** Total execution duration */
  totalDuration: number;
}

/**
 * Plan confirmation callback
 */
export interface PlanConfirmationCallback {
  (plan: ToolExecutionPlan): Promise<{
    confirmed: boolean;
    modifiedPlan?: ToolExecutionPlan;
    feedback?: string;
  }>;
}

// ==================== Configuration Interface ====================

export interface CloudIntentEngineConfig {
  llm: {
    provider: AIConfig["provider"];
    apiKey?: string;
    endpoint?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    maxRetries?: number;
  };
  execution: {
    maxConcurrentTools?: number;
    timeout?: number;
    retryAttempts?: number;
    retryDelay?: number;
  };
  fallback: {
    enableKeywordMatching?: boolean;
    askUserOnFailure?: boolean;
    defaultTools?: Record<string, string>;
  };
  parameterMapping?: {
    validationLevel?: ValidationLevel;
    enableCompatibilityMappings?: boolean;
    logWarnings?: boolean;
    enforceRequired?: boolean;
  };
  /** Language for LLM system prompt: 'zh' for Chinese, 'en' for English (default) */
  language?: 'zh' | 'en';
}

// ==================== Execution Context ====================

interface ExecutionContext {
  results: Map<string, unknown>;
  variables: Map<string, unknown>;
}

// ==================== Function Calling Result Type ====================

/**
 * Result of a function calling query
 */
export interface FunctionCallingResult {
  hasToolCall: boolean;
  toolCalls: Array<{
    toolName: string;
    arguments: Record<string, unknown>;
  }>;
  raw: unknown;
  provider: string;
  text?: string;
}

// ==================== CloudIntentEngine ====================

export class CloudIntentEngine {
  private llmClient: LLMClient;
  private config: CloudIntentEngineConfig;
  private availableTools: Tool[] = [];

  constructor(config: CloudIntentEngineConfig) {
    this.config = config;
    this.llmClient = getLLMClient();
    this.llmClient.configure({
      provider: config.llm.provider,
      apiKey: config.llm.apiKey || "",
      model: config.llm.model || LLMDefaults.MODEL,
      temperature: config.llm.temperature ?? LLMDefaults.TEMPERATURE,
      maxTokens: config.llm.maxTokens ?? LLMDefaults.MAX_TOKENS,
      timeout: config.llm.timeout ?? Timeouts.LLM_REQUEST,
    } as AIConfig);
  }

  /**
   * Set available tools for the engine
   */
  setAvailableTools(tools: Tool[]): void {
    this.availableTools = tools;
    logger.debug(`[CloudIntentEngine] Set ${tools.length} available tools`);
  }

  /**
   * Get available tools
   */
  getAvailableTools(): Tool[] {
    return [...this.availableTools];
  }

  /**
   * Step 1: Plan — Generate a tool execution plan from a user query.
   *
   * Uses LLM function calling to generate a structured plan (DAG) with:
   * - Tool selection based on available MCP tools
   * - Parameter extraction from the query
   * - Dependency ordering between steps
   *
   * The plan is returned WITHOUT executing any tools. The caller should:
   * 1. Present the plan to the user for confirmation
   * 2. Execute the plan after confirmation
   */
  async planQuery(
    query: string,
    options?: {
      systemPrompt?: string;
      model?: string;
      temperature?: number;
      toolChoice?: "auto" | "none" | "required";
      /** Use JSON mode instead of function calling. Useful for providers that don't support tool_choice: "required". */
      useJsonMode?: boolean;
      /** Language for system prompt: 'zh' for Chinese, 'en' for English. Defaults to config.language. */
      language?: 'zh' | 'en';
      /** Network to use for operations. When provided, injects network info into system prompt. */
      network?: 'mainnet' | 'testnet';
    },
  ): Promise<ToolExecutionPlan> {
    logger.info(
      `[CloudIntentEngine] planQuery called: "${query.substring(0, 100)}..."`,
    );

    const startTime = Date.now();

    // Determine effective language and network
    const effectiveLanguage = options?.language || this.config.language || 'en';
    const effectiveNetwork = options?.network || 'mainnet';
    const useJsonMode = options?.useJsonMode ?? false;

    // Build the system prompt with available tools, language, and network
    // If an external systemPrompt is provided, use it as-is (for backward compatibility)
    // Otherwise, build it automatically with language, network, and tool descriptions
    const systemPrompt = options?.systemPrompt || this.buildSystemPrompt({
      useJsonMode,
      language: effectiveLanguage,
      network: effectiveNetwork,
    });

    // Build the user message with the query
    const userMessage = this.buildUserMessage(query);

    try {
      // Determine tool choice mode
      const toolChoice = options?.toolChoice || "auto";

      let response: LLMClientResponse;

      if (useJsonMode) {
        // JSON mode: Use response_format to force LLM to return JSON
        // This is useful for providers (like DeepSeek) that may not support tool_choice: "required"
        // The system prompt already instructs the LLM to return a JSON plan with steps
        response = await this.llmClient.chat({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          temperature: options?.temperature,
          responseFormat: { type: "json_object" },
        });
      } else {
        // Function calling mode: Use tools parameter for structured tool calls
        response = await this.llmClient.chat({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          temperature: options?.temperature,
          tools: toolChoice === "none" ? undefined : this.availableTools.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              description: tool.description || "",
              parameters: tool.inputSchema || { type: "object", properties: {} },
            },
          })),
          toolChoice,
        });
      }

      // Parse the response into a plan
      const plan = this.parseResponseToPlan(query, response);

      const duration = Date.now() - startTime;
      logger.info(
        `[CloudIntentEngine] Plan generated in ${duration}ms with ${plan.steps.length} steps`,
      );

      return plan;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`[CloudIntentEngine] planQuery failed: ${errorMessage}`);

      // Return a fallback plan
      return {
        id: `plan_${Date.now()}`,
        query,
        steps: [],
        confirmed: false,
        createdAt: new Date(),
        summary: `Failed to generate plan: ${errorMessage}`,
      };
    }
  }

  /**
   * Step 2: Confirm — Validate and confirm a plan with user interaction.
   *
   * Calls the confirmation callback to get user feedback on the plan.
   * The callback can:
   * - Confirm the plan as-is
   * - Modify the plan (e.g., reorder steps, change parameters)
   * - Reject the plan with feedback
   */
  async confirmPlan(
    plan: ToolExecutionPlan,
    confirmationCallback: PlanConfirmationCallback,
  ): Promise<ToolExecutionPlan> {
    logger.info(`[CloudIntentEngine] confirmPlan called for plan ${plan.id}`);

    // If the plan has no steps, auto-confirm
    if (plan.steps.length === 0) {
      logger.info("[CloudIntentEngine] Plan has no steps, auto-confirming");
      return {
        ...plan,
        confirmed: true,
        confirmedAt: new Date(),
      };
    }

    // Call the confirmation callback
    try {
      const response = await confirmationCallback(plan);

      if (response.confirmed) {
        const confirmedPlan: ToolExecutionPlan = {
          ...(response.modifiedPlan || plan),
          confirmed: true,
          confirmedAt: new Date(),
        };
        logger.info(`[CloudIntentEngine] Plan ${plan.id} confirmed by user`);
        return confirmedPlan;
      } else {
        logger.info(
          `[CloudIntentEngine] Plan ${plan.id} rejected by user: ${response.feedback || "no feedback"}`,
        );
        return {
          ...plan,
          confirmed: false,
          summary: `User cancelled the plan: ${response.feedback || "User did not provide feedback"}`,
        };
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `[CloudIntentEngine] Confirmation callback failed: ${errorMessage}`,
      );
      return {
        ...plan,
        confirmed: false,
        summary: `Confirmation process error: ${errorMessage}`,
      };
    }
  }

  /**
   * Step 3: Execute — Execute a confirmed tool execution plan.
   *
   * Executes steps in dependency order with:
   * - Variable substitution ({{step_1.result}})
   * - Error handling per step
   * - Duration tracking
   */
  async executePlan(
    plan: ToolExecutionPlan,
    toolExecutor: (
      toolName: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>,
  ): Promise<PlanExecutionResult> {
    logger.info(
      `[CloudIntentEngine] executePlan called for plan ${plan.id} with ${plan.steps.length} steps`,
    );

    const startTime = Date.now();

    if (!plan.confirmed) {
      logger.warn(
        "[CloudIntentEngine] Plan not confirmed, refusing to execute",
      );
      return {
        success: false,
        plan,
        stepResults: [],
        totalDuration: 0,
        finalResult: "Plan has not been confirmed. Call confirmPlan() first.",
      };
    }

    if (plan.steps.length === 0) {
      logger.warn("[CloudIntentEngine] Plan has no steps");
      return {
        success: true,
        plan,
        stepResults: [],
        totalDuration: 0,
        finalResult: "No steps to execute.",
      };
    }

    // Build execution context for variable substitution
    const context: ExecutionContext = {
      results: new Map(),
      variables: new Map(),
    };

    const stepResults: PlanExecutionResult["stepResults"] = [];

    // Topological sort to determine execution order
    const executionOrder = this.topologicalSortPlan(plan.steps);

    if (!executionOrder) {
      return {
        success: false,
        plan,
        stepResults: [],
        totalDuration: Date.now() - startTime,
        finalResult: "Circular dependency detected in plan",
      };
    }

    // Execute steps in order
    for (const stepId of executionOrder) {
      const step = plan.steps.find((s) => s.id === stepId);
      if (!step) {
        stepResults.push({
          stepId,
          toolName: "unknown",
          success: false,
          error: `Step ${stepId} not found in plan`,
          duration: 0,
        });
        continue;
      }

      const stepStartTime = Date.now();

      try {
        // Resolve parameters with variable substitution
        const resolvedArgs = this.resolvePlanParameters(
          step.arguments,
          context,
        );

        // Execute the tool
        const result = await toolExecutor(step.toolName, resolvedArgs);

        // Store result in context
        context.results.set(step.id, result);

        const duration = Date.now() - stepStartTime;

        stepResults.push({
          stepId: step.id,
          toolName: step.toolName,
          success: true,
          result,
          duration,
        });

        logger.info(
          `[CloudIntentEngine] Step ${step.id} (${step.toolName}) completed in ${duration}ms`,
        );
      } catch (error: unknown) {
        const duration = Date.now() - stepStartTime;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        stepResults.push({
          stepId: step.id,
          toolName: step.toolName,
          success: false,
          error: errorMessage,
          duration,
        });

        logger.error(
          `[CloudIntentEngine] Step ${step.id} (${step.toolName}) failed: ${errorMessage}`,
        );

        // Stop execution on first failure
        break;
      }
    }

    const totalDuration = Date.now() - startTime;
    const success = stepResults.every((sr) => sr.success);
    const finalResult = success
      ? stepResults[stepResults.length - 1]?.result
      : undefined;

    return {
      success,
      plan,
      stepResults,
      finalResult,
      totalDuration,
    };
  }

  /**
   * Convenience method: Plan → Confirm → Execute in one call.
   *
   * This is the recommended entry point for the Plan-then-Execute flow.
   */
  async planAndExecute(
    query: string,
    confirmationCallback: PlanConfirmationCallback,
    toolExecutor: (
      toolName: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>,
    options?: {
      systemPrompt?: string;
      model?: string;
      temperature?: number;
    },
  ): Promise<PlanExecutionResult> {
    logger.info(`[CloudIntentEngine] planAndExecute called: "${query}"`);

    // Step 1: Plan
    const plan = await this.planQuery(query, options);
    if (plan.steps.length === 0) {
      return {
        success: false,
        plan,
        stepResults: [],
        totalDuration: 0,
        finalResult: plan.summary,
      };
    }

    // Step 2: Confirm
    const confirmedPlan = await this.confirmPlan(plan, confirmationCallback);
    if (!confirmedPlan.confirmed) {
      return {
        success: false,
        plan: confirmedPlan,
        stepResults: [],
        totalDuration: 0,
        finalResult: confirmedPlan.summary,
      };
    }

    // Step 3: Execute
    return this.executePlan(confirmedPlan, toolExecutor);
  }

  /**
   * Process a query with multi-turn conversation history support.
   * This is used by the ExecuteService for the multi-turn LLM function calling flow.
   */
  async processQueryWithHistory(
    conversationHistory: Array<{ role: string; content: string }>,
    options?: {
      toolChoice?: "auto" | "none";
      model?: string;
      temperature?: number;
    },
  ): Promise<FunctionCallingResult> {
    logger.debug(
      `[CloudIntentEngine] processQueryWithHistory called with ${conversationHistory.length} messages`,
    );

    try {
      const response = await this.llmClient.chat({
        messages: conversationHistory as LLMMessage[],
        temperature: options?.temperature,
        tools: this.availableTools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description || "",
            parameters: tool.inputSchema || { type: "object", properties: {} },
          },
        })),
        toolChoice: options?.toolChoice,
      });

      return this.parseFunctionCallingResponse(response);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `[CloudIntentEngine] processQueryWithHistory failed: ${errorMessage}`,
      );
      return {
        hasToolCall: false,
        toolCalls: [],
        raw: null,
        provider: this.config.llm.provider,
        text: `Error: ${errorMessage}`,
      };
    }
  }

  // ==================== Private Methods ====================

  /**
   * 工具描述的中文翻译映射
   * 当 language='zh' 时，将工具的英文描述替换为中文描述
   */
  private static readonly TOOL_DESCRIPTIONS_ZH: Record<string, { description: string; params: Record<string, string> }> = {
    'cetus_swap': {
      description: '【执行类工具 (EXECUTION)】在 Cetus DEX 上执行真实的代币兑换交易（Swap）。这是执行买卖操作的唯一正确工具。支持任意两种代币之间的兑换，自动路由最优池子。',
      params: {
        coinTypeIn: '输入代币的类型，如 "SUI" 或 "0x2::sui::SUI"',
        coinTypeOut: '输出代币的类型，如 "USDC"',
        amount: '金额（最小单位），如 "1000000000" = 1 SUI',
        byAmountIn: 'true=固定输入金额, false=固定输出金额',
        slippage: '滑点容忍度，如 0.005 = 0.5%',
        poolId: '可选，指定交易池 ID',
      },
    },
    'cetus_view_quote': {
      description: '【仅查询 (READ-ONLY)】仅查看 Cetus DEX 上的兑换报价，不执行交易。严禁将此工具加入到需要执行交易的执行计划中。',
      params: {
        coinTypeIn: '输入代币的完整类型',
        coinTypeOut: '输出代币的完整类型',
        amount: '输入金额（最小单位）',
        byAmountIn: 'true=固定输入, false=固定输出',
      },
    },
    'cetus_view_pools': {
      description: '【仅查询 (READ-ONLY)】仅查看 Cetus DEX 上可用的交易池列表，不执行交易。严禁将此工具加入到执行计划中。',
      params: {
        coinTypeA: '可选，代币 A 的类型',
        coinTypeB: '可选，代币 B 的类型',
      },
    },
    'navi_deposit': {
      description: '【执行类工具 (EXECUTION)】在 Navi Protocol 上执行存入资产的真实交易。存入指定代币到 Navi 借贷池，赚取存款利息。',
      params: {
        coinType: '要存入的代币类型，如 "0x2::sui::SUI"',
        amount: '存入金额（最小单位）',
      },
    },
    'navi_withdraw': {
      description: '【执行类工具 (EXECUTION)】从 Navi Protocol 执行提取资产的真实交易。提取之前存入的资产。',
      params: {
        coinType: '要提取的代币类型',
        amount: '提取金额（最小单位）',
      },
    },
    'navi_borrow': {
      description: '【执行类工具 (EXECUTION)】从 Navi Protocol 执行借出资产的真实交易。使用已存入的资产作为抵押，借出指定代币。',
      params: {
        coinType: '要借出的代币类型',
        amount: '借出金额（最小单位）',
      },
    },
    'navi_repay': {
      description: '【执行类工具 (EXECUTION)】偿还 Navi Protocol 借款的真实交易。归还之前借出的资产。',
      params: {
        coinType: '要偿还的代币类型',
        amount: '偿还金额（最小单位）',
      },
    },
    'sui_transfer': {
      description: '【执行类工具 (EXECUTION)】在 Sui 区块链上执行转账交易。将指定代币发送到目标地址。',
      params: {
        recipient: '接收地址，以 0x 开头',
        amount: '转账金额（最小单位），"all" 表示全部余额',
        coinType: '代币类型，默认 "0x2::sui::SUI"',
      },
    },
    'sui_view_balance': {
      description: '【仅查询 (READ-ONLY)】仅查询 Sui 地址的代币余额，不执行交易。',
      params: {
        address: '要查询的地址',
        coinType: '可选，代币类型，默认 SUI',
      },
    },
  };

  /**
   * Build the system prompt with available tools
   * Supports both Chinese (zh) and English (en) based on config.language
   * When language is 'zh', tool descriptions and parameter descriptions are translated to Chinese.
   *
   * The prompt adapts based on whether JSON mode or function calling mode is used:
   * - JSON mode: LLM returns a JSON object with a "steps" array
   * - Function calling mode: LLM uses tool calls for each step
   *
   * @param options - Optional parameters to override config settings
   * @param options.useJsonMode - Whether to use JSON mode (default: false)
   * @param options.language - Language override ('zh' | 'en'), defaults to config.language
   * @param options.network - Network to inject into prompt ('mainnet' | 'testnet'), defaults to 'mainnet'
   */
  private buildSystemPrompt(options?: {
    useJsonMode?: boolean;
    language?: 'zh' | 'en';
    network?: 'mainnet' | 'testnet';
  }): string {
    const useJsonMode = options?.useJsonMode ?? false;
    const isZh = (options?.language || this.config.language) === 'zh';
    const network = options?.network || 'mainnet';
    const toolsDescription = this.availableTools
      .map((tool) => {
        const zhInfo = CloudIntentEngine.TOOL_DESCRIPTIONS_ZH[tool.name];
        const description = isZh && zhInfo ? zhInfo.description : (tool.description || "No description");

        const params = tool.inputSchema?.properties
          ? Object.entries(tool.inputSchema.properties)
              .map(([key, value]) => {
                const prop = value as Record<string, unknown>;
                const paramDesc = isZh && zhInfo?.params[key]
                  ? zhInfo.params[key]
                  : ((prop.description as string) || "");
                return `  - ${key} (${(prop.type as string) || "string"}): ${paramDesc}`;
              })
              .join("\n")
          : "  No parameters";

        return `Tool: ${tool.name}
Description: ${description}
Parameters:
${params}`;
      })
      .join("\n\n");

    // Network hint to inject into the prompt
    const networkHint = isZh
      ? `当前钱包连接的网络是：${network}。请使用此网络执行所有操作。注意：不要将 network 作为工具的参数返回，network 由系统自动处理。`
      : `Current wallet network: ${network}. Use this network for all operations. IMPORTANT: Do NOT include 'network' as a tool parameter - it is handled automatically by the system.`;

    if (isZh) {
      if (useJsonMode) {
        return `你是一个 Sui 区块链 DeFi 助手，负责将用户的自然语言意图解析为结构化的执行计划。

你有以下 MCP 工具可用：

${toolsDescription}

${networkHint}

关键规则 - 你必须严格遵守：

1. **必须返回 JSON 格式的计划。** 你的响应必须是一个 JSON 对象，包含 "steps" 数组。不要使用 function calling，直接返回 JSON。

2. **在你的计划中只能使用【执行类工具 (EXECUTION)】。** 绝不能使用【仅查询 (READ-ONLY)】工具。READ-ONLY 工具仅用于信息查询。

3. **对于兑换/交换操作**（如"卖出 SUI 买入 USDC"、"用 X 换 Y"、"用 USDC 买 SUI"），必须使用 \`cetus_swap\` 工具。绝不能使用 \`cetus_view_pools\` 或 \`cetus_view_quote\` 来执行交易。

4. **对于多步骤操作**（如"先兑换再存入"、"swap then deposit"），必须识别出所有步骤并生成完整的执行计划。例如用户说"卖出 SUI 买入 USDC，然后存入 Navi"，应该生成两个步骤：cetus_swap + navi_deposit。绝不能遗漏任何步骤。

5. **从用户查询中提取精确金额**并转换为最小单位（例如 0.01 SUI = 10000000 MIST）。

6. **如果后续步骤的金额依赖于前一步的输出（如 swap 后的输出金额），使用 "auto" 作为金额。** 系统会自动计算并填充正确的金额。

7. **每个步骤必须是一个独立的 JSON 对象。** 不要将多个操作合并到一个步骤中。

JSON 格式要求：
\`\`\`json
{
  "summary": "计划的简要描述",
  "steps": [
    {
      "toolName": "cetus_swap",
      "description": "步骤描述",
      "arguments": {
        "coinTypeIn": "0x2::sui::SUI",
        "coinTypeOut": "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
        "amount": "10000000",
        "byAmountIn": true,
        "slippage": 0.005
      },
      "dependsOn": []
    },
    {
      "toolName": "navi_deposit",
      "description": "步骤描述",
      "arguments": {
        "coinType": "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
        "amount": "auto"
      },
      "dependsOn": ["step_1"]
    }
  ]
}
\`\`\`

你的任务是分析用户的请求并生成一个 JSON 计划：
1. 选择合适的执行工具来满足请求
2. 从用户查询中提取参数
3. 正确排序步骤（依赖在前）
4. 为每个步骤提供清晰的描述

重要：对于"卖出 SUI 买入 USDC，然后存入 Navi"，你必须生成两个步骤：cetus_swap + navi_deposit。绝不能遗漏任何步骤。`;
      }

      return `你是一个 Sui 区块链 DeFi 助手，负责将用户的自然语言意图解析为结构化的执行计划。

你有以下 MCP 工具可用：

${toolsDescription}

${networkHint}

关键规则 - 你必须严格遵守：

1. **必须使用 function calling（工具调用）来生成计划。** 不要返回基于文本的 JSON 计划。直接调用可用的工具。每个步骤必须对应一个独立的工具调用。

2. **在你的计划中只能使用【执行类工具 (EXECUTION)】。** 绝不能使用【仅查询 (READ-ONLY)】工具。READ-ONLY 工具仅用于信息查询。

3. **对于兑换/交换操作**（如"卖出 SUI 买入 USDC"、"用 X 换 Y"、"用 USDC 买 SUI"），必须使用 \`cetus_swap\` 工具。绝不能使用 \`cetus_view_pools\` 或 \`cetus_view_quote\` 来执行交易。

4. **对于多步骤操作**（如"先兑换再存入"、"swap then deposit"），必须识别出所有步骤并生成完整的执行计划。例如用户说"卖出 SUI 买入 USDC，然后存入 Navi"，应该生成两个步骤：cetus_swap + navi_deposit。绝不能遗漏任何步骤。

5. **从用户查询中提取精确金额**并转换为最小单位（例如 0.01 SUI = 10000000 MIST）。

6. **如果后续步骤的金额依赖于前一步的输出（如 swap 后的输出金额），使用 "auto" 作为金额。** 系统会自动计算并填充正确的金额。

7. **每个步骤必须使用独立的 function call（工具调用）。** 不要将多个操作合并到一个工具调用中。

你的任务是分析用户的请求并生成一个计划：
1. 选择合适的执行工具来满足请求
2. 从用户查询中提取参数
3. 正确排序步骤（依赖在前）
4. 为每个步骤提供清晰的描述

重要：你必须为每个步骤生成一个独立的 function call（工具调用）。例如，对于"卖出 SUI 买入 USDC，然后存入 Navi"，你必须生成两个独立的 function call：第一个是 cetus_swap，第二个是 navi_deposit。`;
    }

    // English prompts
    if (useJsonMode) {
      return `You are an intelligent assistant that generates structured execution plans for Sui DeFi operations.

You have access to the following MCP tools:

${toolsDescription}

${networkHint}

CRITICAL RULES - You MUST follow these rules strictly:

1. **MUST return a JSON-formatted plan.** Your response must be a JSON object with a "steps" array. Do NOT use function calling, return JSON directly.

2. **Only use EXECUTION tools in your plan.** NEVER use READ-ONLY tools in an execution plan. READ-ONLY tools are for information queries only.

3. **For swap/exchange operations** (e.g., "sell SUI for USDC", "swap X for Y", "buy X with Y"), ALWAYS use the \`cetus_swap\` tool. NEVER use \`cetus_view_pools\` or \`cetus_view_quote\` for execution plans.

4. **For multi-step operations** (e.g., "swap then deposit", "sell X for Y then deposit Z"), generate ALL required steps in the correct order. Each step should depend on the previous step. For example, "sell SUI for USDC then deposit into Navi" should generate TWO steps: cetus_swap + navi_deposit. Never miss any step.

5. **Extract exact amounts from the user's query** and convert to the smallest unit (e.g., 0.01 SUI = 10000000 MIST).

6. **If a subsequent step's amount depends on a previous step's output (e.g., the output of a swap), use "auto" as the amount.** The system will automatically calculate and fill in the correct amount.

7. **Each step MUST be a separate JSON object.** Do NOT combine multiple operations into a single step.

JSON format:
\`\`\`json
{
  "summary": "Brief description of the plan",
  "steps": [
    {
      "toolName": "cetus_swap",
      "description": "Description of the step",
      "arguments": {
        "coinTypeIn": "0x2::sui::SUI",
        "coinTypeOut": "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
        "amount": "10000000",
        "byAmountIn": true,
        "slippage": 0.005
      },
      "dependsOn": []
    },
    {
      "toolName": "navi_deposit",
      "description": "Description of the step",
      "arguments": {
        "coinType": "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
        "amount": "auto"
      },
      "dependsOn": ["step_1"]
    }
  ]
}
\`\`\`

Your task is to analyze the user's request and generate a JSON plan that:
1. Selects the appropriate EXECUTION tools to fulfill the request
2. Extracts parameters from the user's query
3. Orders steps correctly (dependencies first)
4. Provides clear descriptions for each step

IMPORTANT: For "sell SUI for USDC then deposit into Navi", you MUST generate TWO steps: cetus_swap + navi_deposit. Never miss any step.`;
    }

    return `You are an intelligent assistant that generates structured execution plans for Sui DeFi operations.

You have access to the following MCP tools:

${toolsDescription}

${networkHint}

CRITICAL RULES - You MUST follow these rules strictly:

1. **MUST use function calling (tool calls) to generate the plan.** Do NOT return a text-based JSON plan. Use the available tools by calling them directly. Each step MUST be a separate tool call.

2. **Only use EXECUTION tools (marked with 【执行类工具 (EXECUTION)】) in your plan.** NEVER use READ-ONLY tools (marked with 【仅查询 (READ-ONLY)】) in an execution plan. READ-ONLY tools are for information queries only.

3. **For swap/exchange operations** (e.g., "sell SUI for USDC", "swap X for Y", "buy X with Y"), ALWAYS use the \`cetus_swap\` tool. NEVER use \`cetus_view_pools\` or \`cetus_view_quote\` for execution plans.

4. **For multi-step operations** (e.g., "swap then deposit", "sell X for Y then deposit Z"), generate ALL required steps in the correct order. Each step should depend on the previous step. For example, "sell SUI for USDC then deposit into Navi" should generate TWO steps: cetus_swap + navi_deposit. Never miss any step.

5. **Extract exact amounts from the user's query** and convert to the smallest unit (e.g., 0.01 SUI = 10000000 MIST).

6. **If a subsequent step's amount depends on a previous step's output (e.g., the output of a swap), use "auto" as the amount.** The system will automatically calculate and fill in the correct amount.

7. **Each step MUST be a separate function call (tool call).** Do NOT combine multiple operations into a single tool call.

Your task is to analyze the user's request and generate a plan that:
1. Selects the appropriate EXECUTION tools to fulfill the request
2. Extracts parameters from the user's query
3. Orders steps correctly (dependencies first)
4. Provides clear descriptions for each step

IMPORTANT: You MUST generate one separate function call (tool call) for each step. For example, for "sell SUI for USDC then deposit into Navi", you MUST generate TWO separate function calls: first cetus_swap, then navi_deposit.`;
  }

  /**
   * Build the user message with the query
   */
  private buildUserMessage(query: string): string {
    return `User request: ${query}

Please generate a structured execution plan to fulfill this request.`;
  }

  /**
   * Extract JSON object from text that may contain markdown code blocks,
   * surrounding explanatory text, or comments.
   *
   * Handles formats like:
   * - ```json\n{...}\n```
   * - ```\n{...}\n```
   * - { "summary": "...", "steps": [...] }
   * - Here is the plan: { "summary": "...", "steps": [...] }
   */
  private extractJsonFromText(text: string): Record<string, unknown> | null {
    if (!text) return null;

    // Strategy 1: Try to extract from markdown code block (```json ... ``` or ``` ... ```)
    const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/;
    const codeBlockMatch = text.match(codeBlockRegex);
    if (codeBlockMatch) {
      const jsonStr = codeBlockMatch[1].trim();
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed === 'object') {
          logger.debug('[CloudIntentEngine] Successfully parsed JSON from markdown code block');
          return parsed as Record<string, unknown>;
        }
      } catch (e) {
        logger.debug(`[CloudIntentEngine] Failed to parse JSON from code block: ${(e as Error).message}`);
      }
    }

    // Strategy 2: Try to find JSON object by scanning for { and matching braces
    // This handles cases where JSON is embedded in surrounding text
    const jsonObjectRegex = /\{[\s\S]*?\}/g;
    const jsonMatches = text.match(jsonObjectRegex);
    if (jsonMatches) {
      for (const candidate of jsonMatches) {
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            // Check if it looks like a plan (has steps, plan, or summary)
            if (parsed.steps || parsed.plan || parsed.summary) {
              logger.debug('[CloudIntentEngine] Successfully parsed JSON from embedded text');
              return parsed as Record<string, unknown>;
            }
          }
        } catch {
          // Try next candidate
        }
      }
    }

    // Strategy 3: Try direct JSON.parse on the whole text (most common case)
    try {
      const trimmed = text.trim();
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        logger.debug('[CloudIntentEngine] Successfully parsed JSON from direct text');
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not valid JSON
    }

    // Strategy 4: Try to find the first { and last } and parse that substring
    // This handles cases where there's text before/after the JSON
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const jsonCandidate = text.substring(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(jsonCandidate);
        if (parsed && typeof parsed === 'object') {
          logger.debug('[CloudIntentEngine] Successfully parsed JSON from brace-delimited text');
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Not valid JSON
      }
    }

    logger.warn('[CloudIntentEngine] Failed to extract JSON from response text');
    return null;
  }

  /**
   * Parse LLM response into a ToolExecutionPlan
   *
   * Handles both the LLMClientResponse format (with toolCalls containing
   * {id, type, function: {name, arguments}}) and text-based JSON responses.
   */
  private parseResponseToPlan(
    query: string,
    response: LLMClientResponse,
  ): ToolExecutionPlan {
    const plan: ToolExecutionPlan = {
      id: `plan_${Date.now()}`,
      query,
      steps: [],
      confirmed: false,
      createdAt: new Date(),
      summary: "",
    };

    // Build a tool name -> server name lookup from available tools
    const toolServerMap = new Map<string, string>();
    for (const tool of this.availableTools) {
      const serverName = (tool as unknown as Record<string, unknown>)
        .serverName as string | undefined;
      if (serverName && !toolServerMap.has(tool.name)) {
        toolServerMap.set(tool.name, serverName);
      }
    }

    // Try to extract tool calls from the LLMClientResponse format
    if (response.toolCalls && response.toolCalls.length > 0) {
      plan.steps = response.toolCalls.map((tc, index) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        return {
          id: `step_${index + 1}`,
          toolName: tc.function.name,
          serverName: toolServerMap.get(tc.function.name),
          description: `Execute ${tc.function.name} with provided parameters`,
          arguments: args,
          dependsOn: index > 0 ? [`step_${index}`] : [],
        };
      });

      plan.summary = `Plan with ${plan.steps.length} steps using ${plan.steps.map((s) => s.toolName).join(", ")}`;
    } else if (response.text) {
      // Try to extract JSON from the response text using robust extraction
      const parsed = this.extractJsonFromText(response.text);
      if (parsed && parsed.steps && Array.isArray(parsed.steps)) {
        plan.steps = parsed.steps.map(
          (step: Record<string, unknown>, index: number) => ({
            id: (step.id as string) || `step_${index + 1}`,
            toolName: step.toolName as string,
            serverName:
              (step.serverName as string) ||
              toolServerMap.get(step.toolName as string),
            description: (step.description as string) || `Step ${index + 1}`,
            arguments: (step.arguments as Record<string, unknown>) || {},
            dependsOn: (step.dependsOn as string[]) || [],
          }),
        );
        plan.summary =
          (parsed.summary as string) ||
          `Plan with ${plan.steps.length} steps`;
      } else if (parsed && !parsed.steps) {
        // Check if the JSON has a 'plan' field (alternative format)
        if (parsed.plan && Array.isArray(parsed.plan)) {
          plan.steps = parsed.plan.map(
            (step: Record<string, unknown>, index: number) => ({
              id: (step.id as string) || `step_${index + 1}`,
              toolName: (step.toolName as string) || (step.tool as string) || "",
              serverName:
                (step.serverName as string) ||
                toolServerMap.get((step.toolName as string) || (step.tool as string)),
              description: (step.description as string) || `Step ${index + 1}`,
              arguments: (step.arguments as Record<string, unknown>) || (step.params as Record<string, unknown>) || {},
              dependsOn: (step.dependsOn as string[]) || [],
            }),
          );
          plan.summary =
            (parsed.summary as string) ||
            `Plan with ${plan.steps.length} steps`;
          logger.info(`[CloudIntentEngine] Parsed ${plan.steps.length} steps from 'plan' field`);
        } else {
          // Parsed JSON but no steps or plan field - use as summary
          plan.summary = response.text.substring(0, 200);
          logger.warn(`[CloudIntentEngine] Parsed JSON has no 'steps' or 'plan' field: ${JSON.stringify(parsed).substring(0, 200)}`);
        }
      } else {
        // Could not parse JSON at all
        plan.summary = response.text.substring(0, 200);
        logger.warn(`[CloudIntentEngine] Could not parse JSON from response text: "${response.text.substring(0, 200)}..."`);
      }
    }

    return plan;
  }

  /**
   * Parse function calling response from LLMClientResponse format
   */

  private parseFunctionCallingResponse(
    response: LLMClientResponse,
  ): FunctionCallingResult {
    const result: FunctionCallingResult = {
      hasToolCall: false,
      toolCalls: [],
      raw: response.raw || null,
      provider: response.provider,
    };

    if (response.toolCalls && response.toolCalls.length > 0) {
      result.hasToolCall = true;
      result.toolCalls = response.toolCalls.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        return {
          toolName: tc.function.name,
          arguments: args,
        };
      });
    }

    if (response.text) {
      result.text = response.text;
    }

    return result;
  }

  /**
   * Topological sort of plan steps
   * Returns ordered step IDs or null if circular dependency detected
   */
  private topologicalSortPlan(steps: PlanStep[]): string[] | null {
    const graph = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // Initialize graph
    for (const step of steps) {
      graph.set(step.id, step.dependsOn || []);
      inDegree.set(step.id, 0);
    }

    // Calculate in-degrees: count of dependencies for each node
    // A node with 0 dependencies can be executed first
    for (const [nodeId, deps] of graph) {
      inDegree.set(nodeId, deps.length);
    }

    // Kahn's algorithm: start with nodes that have no dependencies
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      sorted.push(node);

      // Find all nodes that depend on 'node' and decrement their in-degree
      for (const [otherNode, deps] of graph) {
        if (deps.includes(node)) {
          const newDegree = (inDegree.get(otherNode) || 0) - 1;
          inDegree.set(otherNode, newDegree);
          if (newDegree === 0) {
            queue.push(otherNode);
          }
        }
      }
    }

    // Check for circular dependency
    if (sorted.length !== steps.length) {
      return null;
    }

    return sorted;
  }

  /**
   * Resolve plan parameters with variable substitution
   * Supports {{step_X.result}} and {{step_X.result.field}} syntax
   */
  private resolvePlanParameters(
    args: Record<string, unknown>,
    context: ExecutionContext,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string" && value.includes("{{")) {
        resolved[key] = this.resolveTemplateString(value, context);
      } else if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        resolved[key] = this.resolvePlanParameters(
          value as Record<string, unknown>,
          context,
        );
      } else if (Array.isArray(value)) {
        resolved[key] = value.map((item) => {
          if (typeof item === "string" && item.includes("{{")) {
            return this.resolveTemplateString(item, context);
          }
          if (typeof item === "object" && item !== null) {
            return this.resolvePlanParameters(
              item as Record<string, unknown>,
              context,
            );
          }
          return item;
        });
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Resolve a template string with variable substitution
   */
  private resolveTemplateString(
    template: string,
    context: ExecutionContext,
  ): string {
    return template.replace(/\{\{(.+?)\}\}/g, (match, expression) => {
      const expr = (expression as string).trim();

      // Check for step result reference: step_X.result or step_X.result.field
      const stepResultMatch = expr.match(/^step_(\d+)\.result(?:\.(.+))?$/);
      if (stepResultMatch) {
        const stepId = `step_${stepResultMatch[1]}`;
        const fieldPath = stepResultMatch[2];
        const result = context.results.get(stepId);

        if (result === undefined) {
          logger.warn(
            `[CloudIntentEngine] Template variable ${match} not found in context`,
          );
          return match;
        }

        if (fieldPath) {
          // Navigate nested object path
          const value = this.getNestedValue(result, fieldPath);
          return value !== undefined ? String(value) : match;
        }

        return typeof result === "object"
          ? JSON.stringify(result)
          : String(result);
      }

      // Check for variable reference: var.name
      const varMatch = expr.match(/^var\.(.+)$/);
      if (varMatch) {
        const varName = varMatch[1];
        const value = context.variables.get(varName);
        if (value === undefined) {
          logger.warn(
            `[CloudIntentEngine] Variable ${varName} not found in context`,
          );
          return match;
        }
        return String(value);
      }

      // Unknown expression, return as-is
      logger.warn(`[CloudIntentEngine] Unknown template expression: ${expr}`);
      return match;
    });
  }

  /**
   * Get a nested value from an object using dot notation
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    const keys = path.split(".");
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (
        typeof current === "object" &&
        key in (current as Record<string, unknown>)
      ) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Describe a tool call for logging
   */
  private describeToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): string {
    const paramSummary = Object.entries(args)
      .map(([key, value]) => {
        const valueStr =
          typeof value === "string"
            ? `"${value.substring(0, 50)}"`
            : String(value);
        return `${key}=${valueStr}`;
      })
      .join(", ");

    return `${toolName}(${paramSummary})`;
  }
}
