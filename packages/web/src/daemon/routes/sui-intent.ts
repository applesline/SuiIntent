/**
 * Sui Intent 路由
 *
 * 提供 Sui DeFi 意图解析和执行能力。
 * 前端调用时传递 apiKey，daemon 用完即弃。
 *
 * 路由：
 * - POST /api/sui/parse-intent: 解析 Sui 自然语言意图为结构化计划
 * - POST /api/sui/build-transaction: 将计划构建为 PTB 交易字节
 */

import http from 'http';
import { CloudIntentEngine } from '@intentorch/core';
import { getSuiMCPTools, getOrchestrator } from '@intentorch/core/sui';
import type { RouteContext } from './status';

/**
 * 处理 Sui Intent 路由
 */
export async function handleSuiIntentRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, res, body } = ctx;

  // POST /api/sui/parse-intent
  if (path === '/api/sui/parse-intent' && method === 'POST') {
    return handleParseSuiIntent(res, body);
  }

  // POST /api/sui/build-transaction
  if (path === '/api/sui/build-transaction' && method === 'POST') {
    return handleBuildTransaction(res, body);
  }

  return false;
}

/**
 * 解析 Sui 自然语言意图
 *
 * 请求体：
 * {
 *   intent: "在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC",
 *   apiKey: "sk-xxx",        // LLM API Key
 *   provider: "deepseek",    // LLM Provider
 *   model: "deepseek-chat"   // LLM Model
 * }
 *
 * 响应：
 * {
 *   success: true,
 *   plan: {
 *     id: "plan_xxx",
 *     summary: "Plan with 2 steps",
 *     steps: [
 *       { id: "step_1", toolName: "cetus_swap", description: "...", arguments: {...}, dependsOn: [] },
 *       { id: "step_2", toolName: "navi_deposit", description: "...", arguments: {...}, dependsOn: ["step_1"] }
 *     ]
 *   }
 * }
 */
async function handleParseSuiIntent(res: http.ServerResponse, body: string): Promise<boolean> {
  try {
    const { intent, apiKey, provider, model } = JSON.parse(body || '{}');

    if (!intent) {
      sendJson(res, 400, { success: false, error: 'Missing required field: intent' });
      return true;
    }

    if (!apiKey) {
      sendJson(res, 400, { success: false, error: 'Missing required field: apiKey' });
      return true;
    }

    // 创建 CloudIntentEngine（用完即弃，不持久化 apiKey）
    const engine = new CloudIntentEngine({
      llm: {
        provider: provider || 'deepseek',
        apiKey,
        model: model || 'deepseek-chat',
        temperature: 0.3,
        maxTokens: 2000,
        timeout: 30000,
        maxRetries: 2,
      },
      execution: {
        maxConcurrentTools: 3,
        timeout: 60000,
        retryAttempts: 1,
        retryDelay: 1000,
      },
      fallback: {
        enableKeywordMatching: true,
        askUserOnFailure: false,
      },
    });

    // 注册 Sui MCP Tools
    const suiTools = getSuiMCPTools();
    engine.setAvailableTools(suiTools);

    console.log(`[SuiIntent] Parsing intent with ${suiTools.length} Sui MCP tools available`);
    console.log(`[SuiIntent] Using provider=${provider || 'deepseek'}, model=${model || 'deepseek-chat'}`);

    // 使用 CloudIntentEngine 解析意图
    const plan = await engine.planQuery(intent, {
      systemPrompt: `你是一个 Sui 区块链 DeFi 助手，负责将用户的自然语言意图解析为结构化的执行计划。

可用的 DeFi 工具：
${suiTools.map(t => `- ${t.name}: ${t.description?.split('\n')[0] || ''}`).join('\n')}

规则：
1. 分析用户意图，选择合适的工具组合
2. 从用户描述中提取参数（代币类型、金额、地址等）
3. 如果有依赖关系，正确设置 dependsOn
4. 如果用户没有指定具体金额，使用 "auto" 表示自动计算
5. 代币类型使用完整格式（如 "0x2::sui::SUI"）
6. 返回结构化的 JSON 计划

示例：
用户说："在 Cetus 上卖出 0.1 SUI 买入 USDC，然后在 Navi 上存入 USDC"
→ 步骤1: cetus_swap (卖出 SUI 换 USDC)
→ 步骤2: navi_deposit (存入 USDC，依赖步骤1)

用户说："在 Cetus 上卖出 SUI 买入 USDC，然后将收益转入 0x123..."
→ 步骤1: cetus_swap (卖出 SUI 换 USDC)
→ 步骤2: sui_transfer (将 USDC 转入目标地址，依赖步骤1)`,
    });

    console.log(`[SuiIntent] Plan generated: ${plan.steps.length} steps`);

    sendJson(res, 200, {
      success: true,
      plan: {
        id: plan.id,
        summary: plan.summary,
        steps: plan.steps.map(step => ({
          id: step.id,
          toolName: step.toolName,
          serverName: step.serverName,
          description: step.description,
          arguments: step.arguments,
          dependsOn: step.dependsOn,
        })),
      },
    });
    return true;
  } catch (error: any) {
    console.error('[SuiIntent] Parse error:', error);
    sendJson(res, 500, {
      success: false,
      error: `Failed to parse intent: ${error.message}`,
    });
    return true;
  }
}

/**
 * 将计划构建为 PTB 交易字节（供前端钱包签名）
 *
 * 使用 CrossProtocolOrchestrator 真正构建 PTB 交易，
 * 返回真实的 txBytes（base64 编码），前端钱包签名后执行。
 *
 * 请求体：
 * {
 *   plan: { steps: [...] },
 *   signerAddress: "0x...",
 *   network: "mainnet" | "testnet"
 * }
 */
async function handleBuildTransaction(res: http.ServerResponse, body: string): Promise<boolean> {
  try {
    const { plan, signerAddress, network } = JSON.parse(body || '{}');

    if (!plan || !plan.steps) {
      sendJson(res, 400, { success: false, error: 'Missing required field: plan' });
      return true;
    }

    if (!signerAddress) {
      sendJson(res, 400, { success: false, error: 'Missing required field: signerAddress' });
      return true;
    }

    // 将前端传来的 plan steps（toolName 格式）转换为 CrossProtocolOrchestrator 能理解的格式
    const crossProtocolSteps = plan.steps.map((step: any) => {
      const { protocol, action } = parseToolName(step.toolName);
      // 标准化参数名：LLM 可能返回不同风格的参数名（如 coinIn/coinOut 或 coinTypeIn/coinTypeOut）
      const normalizedArgs = normalizeStepArguments(protocol, action, step.arguments || {});
      return {
        id: step.id || `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        protocol,
        action,
        description: step.description || `${protocol} ${action}`,
        params: { ...normalizedArgs, action },
        dependsOn: step.dependsOn || [],
      };
    });

    // 构建 CrossProtocolPlan
    const crossProtocolPlan = {
      id: plan.id || `plan_${Date.now()}`,
      query: plan.summary || '',
      steps: crossProtocolSteps,
      canMergeToPTB: true,
      summary: plan.summary || `Execute ${plan.steps.length} step(s)`,
    };

    // 获取或初始化 CrossProtocolOrchestrator
    const resolvedNetwork: 'mainnet' | 'testnet' = (network === 'mainnet' || network === 'testnet') ? network : 'mainnet';
    const orchestrator = getOrchestrator({
      network: resolvedNetwork,
      contractAddresses: {},
      defaultSlippage: 0.005,
    });

    // 确保 orchestrator 已初始化
    await orchestrator.initialize();

    // 构建 PTB 交易
    const tx = await orchestrator.buildPlanTransaction(crossProtocolPlan, signerAddress);

    // 使用 SuiClient 构建真实的 txBytes
    const { SuiClient } = await import('@mysten/sui/client');
    const rpcUrl = resolvedNetwork === 'mainnet'
      ? 'https://fullnode.mainnet.sui.io:443'
      : 'https://fullnode.testnet.sui.io:443';
    const suiClient = new SuiClient({ url: rpcUrl });

    // 构建交易字节（使用 SuiClient 确保 object version/digest 被正确填充）
    // 使用 onlyTransactionKind=true 让 gasData.payment 保持为 null，
    // 这样前端钱包会自己获取 gas coin，避免 daemon 端获取的 gas coin 过时
    const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

    // 将 Uint8Array 转换为 base64
    const txBytesBase64 = Buffer.from(txBytes).toString('base64');

    console.log(`[SuiIntent] Built transaction: ${txBytesBase64.length} bytes base64, ${plan.steps.length} steps`);

    sendJson(res, 200, {
      success: true,
      txBytes: txBytesBase64,
      steps: plan.steps.length,
      message: 'Transaction built. Sign with your wallet to execute.',
    });
    return true;
  } catch (error: any) {
    console.error('[SuiIntent] Build transaction error:', error);
    sendJson(res, 500, {
      success: false,
      error: `Failed to build transaction: ${error.message}`,
    });
    return true;
  }
}

/**
 * 将 toolName 映射为 (protocol, action)
 *
 * toolName 格式："{protocol}_{action}"
 * 例如：cetus_swap → { protocol: 'cetus', action: 'swap' }
 *       navi_deposit → { protocol: 'navi', action: 'deposit' }
 *       sui_transfer → { protocol: 'sui', action: 'transfer' }
 */
function parseToolName(toolName: string): { protocol: string; action: string } {
  const parts = toolName.split('_');
  if (parts.length < 2) {
    throw new Error(`Invalid toolName format: "${toolName}". Expected "{protocol}_{action}"`);
  }
  const protocol = parts[0];
  const action = parts.slice(1).join('_');
  return { protocol, action };
}

/**
 * 标准化步骤参数名
 *
 * LLM 可能返回不同风格的参数名，需要映射为适配器期望的标准参数名。
 * 例如：
 * - coinIn / inputCoin / from → coinTypeIn
 * - coinOut / outputCoin / to → coinTypeOut
 * - amountIn / value / quantity → amount
 */
function normalizeStepArguments(
  protocol: string,
  action: string,
  args: Record<string, any>,
): Record<string, any> {
  const normalized: Record<string, any> = { ...args };

  // Cetus swap 参数名映射
  if (protocol === 'cetus' && action === 'swap') {
    // coinTypeIn 的别名
    if (!normalized.coinTypeIn) {
      normalized.coinTypeIn =
        normalized.coinIn ||
        normalized.inputCoin ||
        normalized.from ||
        normalized.sellCoin ||
        normalized.coinA ||
        undefined;
    }
    // coinTypeOut 的别名
    if (!normalized.coinTypeOut) {
      normalized.coinTypeOut =
        normalized.coinOut ||
        normalized.outputCoin ||
        normalized.to ||
        normalized.buyCoin ||
        normalized.coinB ||
        undefined;
    }
    // amount 的别名
    if (!normalized.amount) {
      normalized.amount =
        normalized.amountIn ||
        normalized.value ||
        normalized.quantity ||
        normalized.inputAmount ||
        undefined;
    }
    // 清理别名，避免混淆
    delete normalized.coinIn;
    delete normalized.inputCoin;
    delete normalized.from;
    delete normalized.sellCoin;
    delete normalized.coinA;
    delete normalized.coinOut;
    delete normalized.outputCoin;
    delete normalized.to;
    delete normalized.buyCoin;
    delete normalized.coinB;
    delete normalized.amountIn;
    delete normalized.value;
    delete normalized.quantity;
    delete normalized.inputAmount;
  }

  // Navi 操作参数名映射
  if (protocol === 'navi') {
    // coinType 的别名
    if (!normalized.coinType) {
      normalized.coinType =
        normalized.coin ||
        normalized.token ||
        normalized.asset ||
        normalized.coinIn ||
        normalized.inputCoin ||
        undefined;
    }
    // amount 的别名
    if (!normalized.amount) {
      normalized.amount =
        normalized.value ||
        normalized.quantity ||
        normalized.amountIn ||
        undefined;
    }
    delete normalized.coin;
    delete normalized.token;
    delete normalized.asset;
    delete normalized.coinIn;
    delete normalized.inputCoin;
    delete normalized.value;
    delete normalized.quantity;
    delete normalized.amountIn;
  }

  // Sui transfer 参数名映射
  if (protocol === 'sui' && action === 'transfer') {
    // recipient 的别名
    if (!normalized.recipient) {
      normalized.recipient =
        normalized.to ||
        normalized.address ||
        normalized.receiver ||
        normalized.destination ||
        undefined;
    }
    // coinType 的别名
    if (!normalized.coinType) {
      normalized.coinType =
        normalized.coin ||
        normalized.token ||
        normalized.asset ||
        undefined;
    }
    delete normalized.to;
    delete normalized.address;
    delete normalized.receiver;
    delete normalized.destination;
    delete normalized.coin;
    delete normalized.token;
    delete normalized.asset;
  }

  return normalized;
}

function sendJson(res: http.ServerResponse, status: number, data: any) {
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}
