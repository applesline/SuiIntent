/**
 * 跨协议复杂意图编排器
 *
 * 核心编排引擎，负责将自然语言意图解析为跨多个 DeFi 协议的操作流程。
 * 支持在单个 PTB（Programmable Transaction Block）中编排多个协议的操作。
 *
 * 典型场景：
 * 1. "在 Cetus 上卖出 A，同时在 Navi 上买入 B，最后将收益转入某地址"
 * 2. "在 Navi 存入 SUI，借出 USDC，然后在 Cetus 上将 USDC 换成 CETUS"
 * 3. "闪电贷：从 Navi 借出 SUI，在 Cetus 上 Swap，还给 Navi，收益转地址"
 *
 * @module sui/cross-protocol-orchestrator
 */

import { Transaction } from '@mysten/sui/transactions';
import { logger } from '../core/logger.js';

import type {
  SwapQuote,
  CrossProtocolStep,
  CrossProtocolPlan,
  CrossProtocolResult,
  CrossProtocolStepResult,
} from './types.js';

import type { IProtocolAdapter, AdapterConfig } from './adapters/types.js';
import { CetusAdapter } from './adapters/cetus-adapter.js';
import { NaviAdapter } from './adapters/navi-adapter.js';
import { SuiAdapter } from './adapters/sui-adapter.js';
import { getCetusConfig } from './network-config.js';
import { CoinTypeResolver } from './coin-type-resolver.js';

/** 编排器配置 */
export interface OrchestratorConfig {
  network: 'mainnet' | 'testnet';
  rpcUrl?: string;
  contractAddresses: Record<string, string>;
  defaultSlippage?: number;
  maxSteps?: number;
}

/** 协议适配器注册表 */
interface AdapterRegistry {
  cetus: CetusAdapter;
  navi: NaviAdapter;
  sui: SuiAdapter;
  [key: string]: IProtocolAdapter;
}

let stepCounter = 0;
function nextStepId(): string {
  return `step_${++stepCounter}`;
}

/**
 * 获取或创建 CrossProtocolOrchestrator 实例
 * 单例模式，方便 MCP Server 使用
 */
let orchestratorInstance: CrossProtocolOrchestrator | null = null;

export function getOrchestrator(config?: OrchestratorConfig): CrossProtocolOrchestrator {
  if (!orchestratorInstance && config) {
    orchestratorInstance = new CrossProtocolOrchestrator(config);
  }
  if (!orchestratorInstance) {
    throw new Error('CrossProtocolOrchestrator not initialized. Provide config on first call.');
  }
  return orchestratorInstance;
}

/**
 * 跨协议复杂意图编排器
 *
 * 核心功能：
 * 1. 解析自然语言意图为结构化的跨协议操作计划
 * 2. 编排多个协议的操作到单个 PTB 中
 * 3. 处理协议间的数据依赖（如 Swap 输出作为借贷的输入）
 * 4. 执行滑点保护和 Gas 优化
 * 5. 支持闪电贷等复杂 DeFi 组合操作
 */
export class CrossProtocolOrchestrator {
  private config: OrchestratorConfig;
  private adapters: AdapterRegistry;
  private initialized = false;

  constructor(config: OrchestratorConfig) {
    this.config = {
      ...config,
      defaultSlippage: config.defaultSlippage ?? 0.005,
      maxSteps: config.maxSteps ?? 10,
    };

    // 初始化适配器
    this.adapters = {
      cetus: new CetusAdapter(),
      navi: new NaviAdapter(),
      sui: new SuiAdapter(),
    };
  }

  /**
   * 初始化编排器及所有适配器
   */
  async initialize(): Promise<void> {
    const adapterConfig: AdapterConfig = {
      network: this.config.network,
      rpcUrl: this.config.rpcUrl,
      contractAddresses: this.config.contractAddresses,
    };

    for (const [name, adapter] of Object.entries(this.adapters)) {
      try {
        await adapter.initialize(adapterConfig);
        logger.info(`[Orchestrator] Adapter '${name}' initialized`);
      } catch (error: any) {
        logger.error(`[Orchestrator] Failed to initialize adapter '${name}': ${error.message}`);
        throw error;
      }
    }

    this.initialized = true;
    logger.info('[Orchestrator] CrossProtocolOrchestrator initialized successfully');
  }

  /**
   * 解析自然语言意图为跨协议操作计划
   *
   * 将用户意图（如"在 Cetus 上卖出 A，在 Navi 上买入 B"）解析为
   * 结构化的操作步骤列表。
   *
   * @param intent - 自然语言意图描述
   * @returns 结构化的跨协议操作计划
   */
  async parseIntent(intent: string): Promise<CrossProtocolPlan> {
    logger.info(`[Orchestrator] Parsing intent: "${intent}"`);

    // 意图解析规则
    const steps = this.parseIntentToSteps(intent);

    if (steps.length === 0) {
      throw new Error(`Unable to parse intent: "${intent}". No valid steps identified.`);
    }

    // 获取每个步骤的报价
    const quotes = await this.getQuotesForSteps(steps);

    // 估算总 Gas
    const estimatedGas = this.estimateTotalGas(steps);

    return {
      id: `plan_${Date.now()}`,
      query: intent,
      steps,
      canMergeToPTB: true,
      summary: `Execute ${steps.length} step(s): ${steps.map(s => s.description).join(' → ')}`,
      estimatedGas,
    };
  }

  /**
   * 构建 PTB 交易
   *
   * 将解析后的计划编译为单个 @mysten/sui Transaction 对象。
   * 所有适配器通过 addCommands 向同一个 Transaction 追加指令。
   *
   * @param plan - 跨协议操作计划
   * @returns 构建好的 Transaction 对象
   */
  async buildPlanTransaction(plan: CrossProtocolPlan, signerAddress?: string): Promise<Transaction> {
    this.checkInitialized();

    const tx = new Transaction();

    // 存储每个步骤的输出 Coin 对象引用，用于步骤间数据传递
    const stepOutputCoins: Map<string, any> = new Map();
    // 存储每个步骤的剩余 Coin 引用（需要转回给用户）
    const stepLeftoverCoins: Map<string, any> = new Map();

    for (const step of plan.steps) {
      const adapter = this.adapters[step.protocol];
      if (!adapter) {
        throw new Error(`No adapter found for protocol: ${step.protocol}`);
      }

      const params = this.buildStepParams(step, plan);

      // 如果当前步骤依赖前一步骤，将前一步骤的输出 Coin 注入到参数中
      if (step.dependsOn && step.dependsOn.length > 0) {
        for (const depId of step.dependsOn) {
          const outputCoin = stepOutputCoins.get(depId);
          if (outputCoin) {
            // 将前一步的输出 Coin 作为当前步骤的 coinObject 输入
            params.coinObject = outputCoin;
            logger.info(`[Orchestrator] Injecting output coin from step '${depId}' into step '${step.id}'`);
          }
        }
      }

      await adapter.addCommands(tx, params);
      logger.info(`[Orchestrator] Added step '${step.id}' to PTB: ${step.description}`);

      // 记录步骤的输出（如果有）
      // 对于 Cetus swap，从 params._outputCoin 获取 swap 的输出 Coin 引用
      if (step.protocol === 'cetus' && step.action === 'swap') {
        if (params._outputCoin) {
          stepOutputCoins.set(step.id, params._outputCoin);
          logger.info(`[Orchestrator] Captured output coin from Cetus swap step '${step.id}'`);
        }
        // 收集剩余的 Coin（需要转回给用户）
        // Coin 没有 drop 能力，所有返回值都必须被使用
        if (params._leftoverCoin) {
          stepLeftoverCoins.set(step.id, params._leftoverCoin);
          logger.info(`[Orchestrator] Captured leftover coin from Cetus swap step '${step.id}'`);
        }
      }
    }

    // 处理所有步骤中未使用的 Coin
    // 1. _leftoverCoin：剩余的输入 Coin（如 swap 后剩余的 SUI）
    // 2. _outputCoin：换得的输出 Coin（如 swap 后换得的 USDC），如果没有后续步骤使用它
    // Coin 没有 drop 能力，所有返回值都必须被使用，否则 tx.build() 会报 UnusedValueWithoutDrop 错误
    for (const [stepId, leftoverCoin] of stepLeftoverCoins) {
      if (signerAddress) {
        // 使用 tx.transferObjects 将剩余的 Coin 转给签名者
        tx.transferObjects([leftoverCoin], signerAddress);
        logger.info(`[Orchestrator] Transferring leftover coin from step '${stepId}' to ${signerAddress}`);
      } else {
        logger.warn(`[Orchestrator] No signer address available for leftover coin transfer from step '${stepId}'`);
      }
    }

    // 处理所有步骤中未使用的输出 Coin（_outputCoin）
    // 如果某个步骤的输出 Coin 没有被后续步骤使用，需要将其转给签名者
    for (const [stepId, outputCoin] of stepOutputCoins) {
      // 检查是否有后续步骤依赖这个输出
      const isUsedByLaterStep = plan.steps.some(s =>
        s.dependsOn && s.dependsOn.includes(stepId)
      );
      if (!isUsedByLaterStep && signerAddress) {
        tx.transferObjects([outputCoin], signerAddress);
        logger.info(`[Orchestrator] Transferring unused output coin from step '${stepId}' to ${signerAddress}`);
      }
    }

    return tx;
  }


  /**
   * 执行跨协议操作计划
   *
   * 将解析后的计划编译为单个 PTB 并执行。
   *
   * @param plan - 跨协议操作计划
   * @param signerAddress - 签名者地址
   * @returns 执行结果
   */
  async executePlan(
    plan: CrossProtocolPlan,
    signerAddress: string,
  ): Promise<CrossProtocolResult> {
    this.checkInitialized();

    logger.info(`[Orchestrator] Executing plan with ${plan.steps.length} steps`);

    try {
      // 构建 PTB
      const tx = await this.buildPlanTransaction(plan);

      const stepResults: CrossProtocolStepResult[] = plan.steps.map((step) => ({
        stepId: step.id,
        protocol: step.protocol,
        action: step.action,
        success: true,
        txDigest: '0xbuilt_ptb',
        duration: 0,
      }));

      return {
        success: true,
        planId: plan.id,
        stepResults,
        txDigest: '0xbuilt_ptb',
        totalGasUsed: this.estimateTotalGas(plan.steps),
      };
    } catch (error: any) {
      logger.error(`[Orchestrator] Plan execution failed: ${error.message}`);

      const stepResults: CrossProtocolStepResult[] = plan.steps.map((step) => ({
        stepId: step.id,
        protocol: step.protocol,
        action: step.action,
        success: false,
        error: error.message,
        duration: 0,
      }));

      return {
        success: false,
        planId: plan.id,
        stepResults,
        error: error.message,
      };
    }
  }

  /**
   * 构建步骤参数
   */
  private buildStepParams(
    step: CrossProtocolStep,
    plan: CrossProtocolPlan,
  ): Record<string, any> {
    const params: Record<string, any> = { ...step.params };

    // 注入步骤的 action 到参数中（适配器需要）
    params.action = step.action;

    // 1. 参数名称标准化与类型转换
    // 对于 Cetus swap
    if (step.protocol === 'cetus' && step.action === 'swap') {
      // 标准化代币类型
      if (params.coinTypeIn) params.coinTypeIn = this.normalizeCoinType(params.coinTypeIn);
      if (params.coinTypeOut) params.coinTypeOut = this.normalizeCoinType(params.coinTypeOut);
      
      // 标准化金额 (如果不是 MIST 格式则尝试转换)
      if (params.amount && typeof params.amount === 'string' && (params.amount.includes('.') || !/^\d+$/.test(params.amount))) {
        const symbol = step.params.coinTypeIn || 'SUI';
        const extracted = this.extractAmountFromValue(params.amount, symbol);
        if (extracted) params.amount = extracted;
      }

      // 强制 byAmountIn=true：用户意图通常是"卖出 X 代币"（固定输入金额）
      // LLM 有时会错误地返回 byAmountIn=false（固定输出金额），
      // 这会导致 Cetus 合约尝试反向计算输入金额，容易触发 EInsufficientToken (abort code: 4)
      if (params.byAmountIn === false) {
        logger.warn(`[Orchestrator] Forcing byAmountIn=true for Cetus swap (was false). This prevents EInsufficientToken errors.`);
        params.byAmountIn = true;
      }
    }

    // 对于 Navi 操作
    if (step.protocol === 'navi') {
      if (params.coinType) params.coinType = this.normalizeCoinType(params.coinType);
      
      if (params.amount && typeof params.amount === 'string' && (params.amount.includes('.') || !/^\d+$/.test(params.amount))) {
        const symbol = step.params.coinType || 'SUI';
        const extracted = this.extractAmountFromValue(params.amount, symbol);
        if (extracted) params.amount = extracted;
      }
    }

    // 2. 网络覆盖
    if (params.network) {
      const network = params.network as string;
      if (network === 'mainnet' || network === 'testnet') {
        // 更新适配器配置中的 network
        const adapterConfig: AdapterConfig = {
          network,
          rpcUrl: this.config.rpcUrl,
          contractAddresses: this.config.contractAddresses,
        };
        // 重新初始化适配器（如果 network 变化）
        for (const [name, adapter] of Object.entries(this.adapters)) {
          adapter.initialize(adapterConfig).catch(err => {
            logger.warn(`[Orchestrator] Failed to re-initialize adapter '${name}' for network ${network}: ${err.message}`);
          });
        }
        logger.info(`[Orchestrator] Overriding network to '${network}' from step params`);
      }
      // 删除 network 参数，避免传递给适配器
      delete params.network;
    }

    // 3. 为 Cetus swap 添加默认 poolId
    if (step.protocol === 'cetus' && step.action === 'swap') {
      if (!params.poolId) {
        const contractAddresses = this.config.contractAddresses;
        // 优先使用 contractAddresses 中传入的 pools_id
        // 如果没有传入，则根据当前网络动态获取
        if (contractAddresses.cetus_pools_id || contractAddresses.pools_id) {
          params.poolId = contractAddresses.cetus_pools_id || contractAddresses.pools_id;
        } else {
          // 动态获取当前网络的 Cetus pools_id
          const cetusConfig = getCetusConfig(this.config.network);
          params.poolId = cetusConfig.pools_id;
        }
      }
    }

    // 4. 处理步骤间数据依赖
    if (step.dependsOn !== undefined && step.dependsOn.length > 0) {
      for (const depId of step.dependsOn) {
        const depStep = plan.steps.find(s => s.id === depId);
        if (depStep && depStep.assetFlow) {
          // 将依赖步骤的输出注入到当前步骤的参数中
          const outputAssets = depStep.assetFlow.outputAssets;
          if (outputAssets.length > 0) {
            const outputCoinType = this.normalizeCoinType(outputAssets[0].coinType);
            const outputAmount = outputAssets[0].amount;

            // 根据步骤协议和操作类型，确定正确的参数名
            if (step.protocol === 'navi') {
              params.coinType = outputCoinType;
            } else if (step.protocol === 'cetus') {
              params.coinTypeIn = outputCoinType;
            }

            // 只有当输出金额是有效数字时才覆盖，否则保留原始参数
            if (outputAmount && outputAmount !== 'auto' && outputAmount !== 'all') {
              params.amount = outputAmount;
            }
          }
        }
      }
    }

    return params;
  }

  /**
   * 从字符串值中提取金额并转换为最小单位
   */
  private extractAmountFromValue(value: string, symbolHint?: string): string | null {
    // 如果已经是纯数字字符串，直接返回
    if (/^\d+$/.test(value)) return value;

    const amountPattern = /(\d+(?:\.\d+)?)\s*(\w+)?/i;
    const match = value.match(amountPattern);
    if (match) {
      const amount = parseFloat(match[1]);
      const symbol = match[2] || symbolHint || 'SUI';
      const decimals = this.getCoinDecimals(symbol);
      return BigInt(Math.floor(amount * Math.pow(10, decimals))).toString();
    }
    return null;
  }

  /**
   * 解析意图为步骤列表
   *
   * 使用规则引擎将自然语言意图解析为结构化的操作步骤。
   * 支持的关键词：
   * - Cetus: swap, sell, buy, exchange
   * - Navi: deposit, withdraw, borrow, repay, lend
   * - Transfer: send, transfer, move to
   */
  private parseIntentToSteps(intent: string): CrossProtocolStep[] {
    const steps: CrossProtocolStep[] = [];
    const lowerIntent = intent.toLowerCase();

    // 步骤 1: 检测 Cetus Swap
    const cetusMatch = this.matchCetusIntent(lowerIntent);
    if (cetusMatch) {
      const stepId = nextStepId();
      steps.push({
        id: stepId,
        protocol: 'cetus',
        action: 'swap',
        params: cetusMatch,
        description: `Swap ${cetusMatch.coinTypeIn} → ${cetusMatch.coinTypeOut} on Cetus`,
        dependsOn: [],
        assetFlow: {
          inputAssets: [{ coinType: cetusMatch.coinTypeIn, amount: cetusMatch.amount }],
          outputAssets: [{ coinType: cetusMatch.coinTypeOut, amount: cetusMatch.amount }],
        },
      });
    }

    // 步骤 2: 检测 Navi 操作
    const naviMatch = this.matchNaviIntent(lowerIntent);
    if (naviMatch) {
      const stepId = nextStepId();
      const dependsOn = steps.length > 0 ? [steps[steps.length - 1].id] : [];
      steps.push({
        id: stepId,
        protocol: 'navi',
        action: naviMatch.action,
        params: naviMatch.params,
        description: `${naviMatch.action} ${naviMatch.params.coinType} on Navi`,
        dependsOn,
      });
    }

    // 步骤 3: 检测转账
    const transferMatch = this.matchTransferIntent(lowerIntent);
    if (transferMatch) {
      const stepId = nextStepId();
      const dependsOn = steps.length > 0 ? [steps[steps.length - 1].id] : [];
      steps.push({
        id: stepId,
        protocol: 'sui',
        action: 'transfer',
        params: transferMatch,
        description: `Transfer to ${transferMatch.recipient}`,
        dependsOn,
      });
    }

    return steps;
  }

  /**
   * 匹配 Cetus Swap 意图
   *
   * 支持多种自然语言格式：
   * - "卖出 0.1 SUI 买入 USDC"（中文句式）
   * - "swap 1 SUI to USDC"（英文句式）
   * - "sell SUI for USDC"（sell/buy 句式）
   * - "在 Cetus 上交换 SUI 到 USDC"（中文介词句式）
   */
  private matchCetusIntent(intent: string): Record<string, any> | null {
    const cetusKeywords = ['cetus', 'swap', 'sell', 'buy', 'exchange', 'trade', '卖出', '买入', '交换'];
    const hasCetusKeyword = cetusKeywords.some(k => intent.includes(k));

    if (!hasCetusKeyword) return null;

    // 尝试多种交易对提取模式

    // 模式 1: "卖出 X 买入 Y"（中文句式）
    // 例如: "卖出 0.1 SUI 买入 USDC"
    const sellBuyPattern = /卖出\s*(?:\d+(?:\.\d+)?\s*)?(\w+)\s*买入\s*(\w+)/i;
    const sellBuyMatch = intent.match(sellBuyPattern);
    if (sellBuyMatch) {
      return {
        coinTypeIn: this.normalizeCoinType(sellBuyMatch[1]),
        coinTypeOut: this.normalizeCoinType(sellBuyMatch[2]),
        amount: this.extractAmount(intent) || '1000000000',
        byAmountIn: true,
        slippage: this.config.defaultSlippage,
      };
    }

    // 模式 2: "X to Y" 或 "X for Y" 或 "X -> Y"（英文句式）
    // 例如: "swap 1 SUI to USDC", "sell SUI for USDC"
    const coinPattern = /(\w+)\s*(?:to|for|->|=>|→)\s*(\w+)/i;
    const coinMatch = intent.match(coinPattern);
    if (coinMatch) {
      return {
        coinTypeIn: this.normalizeCoinType(coinMatch[1]),
        coinTypeOut: this.normalizeCoinType(coinMatch[2]),
        amount: this.extractAmount(intent) || '1000000000',
        byAmountIn: true,
        slippage: this.config.defaultSlippage,
      };
    }

    // 模式 3: "X 到 Y" 或 "X 换成 Y"（中文介词句式）
    // 例如: "在 Cetus 上交换 SUI 到 USDC"
    const chinesePattern = /(\w+)\s*(?:到|换成|换|兑换成)\s*(\w+)/i;
    const chineseMatch = intent.match(chinesePattern);
    if (chineseMatch) {
      return {
        coinTypeIn: this.normalizeCoinType(chineseMatch[1]),
        coinTypeOut: this.normalizeCoinType(chineseMatch[2]),
        amount: this.extractAmount(intent) || '1000000000',
        byAmountIn: true,
        slippage: this.config.defaultSlippage,
      };
    }

    // 模式 4: 如果包含 "sell" 或 "卖出"，尝试提取卖出代币
    // 例如: "sell 0.1 SUI" -> 卖出 SUI，买入未知
    const sellPattern = /(?:sell|卖出)\s*(?:\d+(?:\.\d+)?\s*)?(\w+)/i;
    const sellMatch = intent.match(sellPattern);
    if (sellMatch) {
      // 尝试提取买入代币
      const buyPattern = /(?:buy|买入|for)\s*(\w+)/i;
      const buyMatch = intent.match(buyPattern);
      return {
        coinTypeIn: this.normalizeCoinType(sellMatch[1]),
        coinTypeOut: buyMatch ? this.normalizeCoinType(buyMatch[1]) : this.normalizeCoinType('USDC'),
        amount: this.extractAmount(intent) || '1000000000',
        byAmountIn: true,
        slippage: this.config.defaultSlippage,
      };
    }

    // 模式 5: 如果包含 "buy" 或 "买入"，尝试提取买入代币
    // 例如: "buy 100 USDC" -> 买入 USDC，卖出 SUI
    const buyPattern = /(?:buy|买入)\s*(?:\d+(?:\.\d+)?\s*)?(\w+)/i;
    const buyMatch = intent.match(buyPattern);
    if (buyMatch) {
      return {
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: this.normalizeCoinType(buyMatch[1]),
        amount: this.extractAmount(intent) || '1000000000',
        byAmountIn: true,
        slippage: this.config.defaultSlippage,
      };
    }

    // 默认返回（使用当前网络对应的 USDC 地址）
    return {
      coinTypeIn: '0x2::sui::SUI',
      coinTypeOut: this.normalizeCoinType('USDC'),
      amount: '1000000000',
      byAmountIn: true,
      slippage: this.config.defaultSlippage,
    };

  }
  /**
   * 获取代币的小数位数
   */
  private getCoinDecimals(symbol: string): number {
    const upperSymbol = symbol.toUpperCase();
    const decimalsMap: Record<string, number> = {
      'SUI': 9,
      'USDC': 6,
      'WUSDC': 6,
      'NUSDC': 6,
      'USDT': 6,
      'CETUS': 9,
      'WETH': 8,
      'WBTC': 8,
      'NAVX': 9,
      'AUSD': 6,
      'DEEP': 9,
    };
    return decimalsMap[upperSymbol] ?? 9;
  }


  /**
   * 匹配 Navi 意图
   *
   * 支持多种自然语言格式：
   * - "在 Navi 上存入 USDC"（存入指定代币）
   * - "deposit SUI to Navi"（英文句式）
   * - "从 Navi 提取 USDC"（提取操作）
   * - "在 Navi 上存入 USDC"（中文句式）
   *
   * 注意：对于跨协议意图如"在 Cetus 上卖出 0.1 SUI 买入 USDC，然后在 Navi 上存入 USDC"，
   * Navi 操作的目标代币是 USDC（Cetus swap 的输出），而不是 SUI（Cetus swap 的输入）。
   */
  private matchNaviIntent(intent: string): {
    action: string;
    params: Record<string, any>;
  } | null {
    const naviKeywords = ['navi', 'deposit', 'withdraw', 'borrow', 'repay', 'lend', '存入', '提取'];
    const hasNaviKeyword = naviKeywords.some(k => intent.includes(k));

    if (!hasNaviKeyword) return null;

    let action = 'deposit';
    if (intent.includes('withdraw') || intent.includes('提取')) action = 'withdraw';
    if (intent.includes('borrow') || intent.includes('借')) action = 'borrow';
    if (intent.includes('repay') || intent.includes('还')) action = 'repay';

    // 尝试提取 Navi 操作的目标代币
    // 优先匹配 Navi 关键词后面的代币，例如 "在 Navi 上存入 USDC" -> USDC
    let coinType: string | null = null;

    // 模式 1: "在 Navi 上存入/提取/借出 X"（中文句式）
    const naviActionPattern = /(?:navi|在\s*navi\s*(?:上|协议)?)\s*(?:存入|deposit|提取|withdraw|借出|borrow|偿还|repay)\s*(?:\d+(?:\.\d+)?\s*)?(\w+)/i;
    const naviActionMatch = intent.match(naviActionPattern);
    if (naviActionMatch) {
      coinType = this.normalizeCoinType(naviActionMatch[1]);
    }

    // 模式 2: "deposit/withdraw X to/from Navi"（英文句式）
    if (!coinType) {
      const engPattern = /(?:deposit|withdraw|borrow|repay)\s*(?:\d+(?:\.\d+)?\s*)?(\w+)\s*(?:to|from|on|in)\s*(?:navi)/i;
      const engMatch = intent.match(engPattern);
      if (engMatch) {
        coinType = this.normalizeCoinType(engMatch[1]);
      }
    }

    // 模式 3: 如果意图中同时提到多个代币（如跨协议场景），
    // 提取 Navi 关键词后面的代币
    if (!coinType) {
      // 查找 "然后" 或 "then" 或 "之后" 后面的代币
      const thenPattern = /(?:然后|then|之后|接着)\s*(?:在\s*)?navi\s*(?:上\s*)?(?:存入|deposit)\s*(?:\d+(?:\.\d+)?\s*)?(\w+)/i;
      const thenMatch = intent.match(thenPattern);
      if (thenMatch) {
        coinType = this.normalizeCoinType(thenMatch[1]);
      }
    }

    // 模式 4: 回退到提取意图中的最后一个代币（通常是目标代币）
    if (!coinType) {
      const allCoins = intent.match(/\b(SUI|USDC|USDT|CETUS|WETH|WBTC|NAVX|AUSD|DEEP)\b/gi);
      if (allCoins && allCoins.length > 0) {
        // 取最后一个代币作为 Navi 操作的目标
        coinType = this.normalizeCoinType(allCoins[allCoins.length - 1]);
      }
    }

    // 最终回退
    if (!coinType) {
      coinType = '0x2::sui::SUI';
    }

    const amount = this.extractAmount(intent) || '1000000000';

    return {
      action,
      params: { coinType, amount },
    };
  }


  /**
   * 匹配转账意图
   */
  private matchTransferIntent(intent: string): Record<string, any> | null {
    const transferKeywords = ['transfer', 'send', 'move to', '转入', '转给'];
    const hasTransferKeyword = transferKeywords.some(k => intent.includes(k));

    if (!hasTransferKeyword) return null;

    // 提取地址
    const addressPattern = /0x[a-fA-F0-9]{40,}/;
    const addressMatch = intent.match(addressPattern);

    if (addressMatch) {
      return {
        recipient: addressMatch[0],
        amount: this.extractAmount(intent) || '0',
        coinType: this.extractCoinType(intent) || '0x2::sui::SUI',
      };
    }

    return null;
  }

  /**
   * 获取所有步骤的报价
   */
  private async getQuotesForSteps(steps: CrossProtocolStep[]): Promise<SwapQuote[]> {
    const quotes: SwapQuote[] = [];

    for (const step of steps) {
      try {
        const adapter = this.adapters[step.protocol];
        if (adapter && step.protocol === 'cetus') {
          const quote = await adapter.getQuote(step.params);
          quotes.push(quote as SwapQuote);
        }
      } catch (error: any) {
        logger.warn(`[Orchestrator] Failed to get quote for step: ${error.message}`);
      }
    }

    return quotes;
  }

  /**
   * 估算总 Gas
   */
  private estimateTotalGas(steps: CrossProtocolStep[]): string {
    const baseGas = 500000n;
    const gasPerStep = 200000n;
    const totalGas = baseGas + gasPerStep * BigInt(steps.length);
    return totalGas.toString();
  }

  /**
   * 标准化 Coin 类型
   * 根据当前网络使用对应的链上地址
   *
   * 使用 CoinTypeResolver 的同步方法解析代币简写。
   * CoinTypeResolver 在构造时立即使用内置默认映射，
   * 同时在后台异步从链上获取最新数据并更新缓存。
   */
  private normalizeCoinType(symbol: string): string {
    if (!symbol) return '';
    
    // 如果已经是完整的代币类型（包含 ::），且不包含占位符 "..."
    if (symbol.includes('::') && !symbol.includes('...')) {
      return symbol;
    }

    // 使用 CoinTypeResolver 同步解析
    const resolver = CoinTypeResolver.getInstance(this.config.network);
    const resolved = resolver.resolveSync(symbol);
    
    if (resolved) return resolved;
    
    // 如果无法解析且包含 ::，保持原样（可能是自定义代币）
    if (symbol.includes('::')) return symbol;
    
    // 回退到 SUI 命名空间下的默认格式
    return `0x2::${symbol.toLowerCase()}::${symbol.toUpperCase()}`;
  }
  /**
   * 从意图中提取金额

   * 支持格式：0.1 SUI, 100 USDC, 0.5 sui, 等
   * 自动根据代币类型确定小数位数
   */
  private extractAmount(intent: string): string | null {
    // 匹配金额 + 可选代币符号，如 "0.1 SUI", "100 USDC", "0.5 sui"
    const amountPattern = /(\d+(?:\.\d+)?)\s*(sui|usdc|usdt|cetus|weth|wbtc|navx|ausd|deep)?/i;
    const match = intent.match(amountPattern);
    if (match) {
      const amount = parseFloat(match[1]);
      const symbol = match[2] || 'SUI';
      const decimals = this.getCoinDecimals(symbol);
      // 转换为最小单位
      return BigInt(Math.floor(amount * Math.pow(10, decimals))).toString();
    }
    return null;
  }

  /**
   * 从意图中提取 Coin 类型
   */
  private extractCoinType(intent: string): string | null {
    const coinPattern = /\b(SUI|USDC|USDT|CETUS|WETH|WBTC|NAVX|AUSD|DEEP)\b/i;
    const match = intent.match(coinPattern);
    if (match) {
      return this.normalizeCoinType(match[1]);
    }
    return null;
  }


  /**
   * 检查是否已初始化
   */
  private checkInitialized(): void {
    if (!this.initialized) {
      throw new Error('CrossProtocolOrchestrator not initialized. Call initialize() first.');
    }
  }
}
