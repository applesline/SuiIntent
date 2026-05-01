#!/usr/bin/env node

/**
 * Sui Intent MCP Server
 *
 * 提供基于 MCP 协议的 Sui 跨协议意图编排服务。
 * 通过 MCP 工具接口暴露编排能力，使 AI Agent 可以：
 * 1. 解析自然语言意图为执行计划
 * 2. 执行跨协议操作（Cetus Swap + Navi Deposit + Sui Transfer）
 * 3. 查询执行状态和结果
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import {
  CrossProtocolOrchestrator,
  getOrchestrator,
} from '@intentorch/core/sui';
import type { CrossProtocolPlan, CrossProtocolResult } from '@intentorch/core/sui';

/** MCP Server 配置 */
interface ServerConfig {
  rpcUrl: string;
  network: 'mainnet' | 'testnet' | 'devnet' | 'localnet';
  cetusPackageId?: string;
  cetusGlobalConfigId?: string;
  naviPackageId?: string;
  naviStorageId?: string;
}

/** 默认配置 */
const DEFAULT_CONFIG: ServerConfig = {
  rpcUrl: 'https://fullnode.mainnet.sui.io:443',
  network: 'mainnet',
};

/**
 * Sui Intent MCP Server
 */
class SuiIntentMCPServer {
  private server: Server;
  private orchestrator: CrossProtocolOrchestrator;
  private config: ServerConfig;

  constructor(config?: Partial<ServerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初始化编排器
    const effectiveNetwork: 'mainnet' | 'testnet' = this.config.network === 'mainnet' ? 'mainnet' : 'testnet';
    this.orchestrator = getOrchestrator({
      network: effectiveNetwork,
      rpcUrl: this.config.rpcUrl,
      contractAddresses: {
        cetusPackageId: this.config.cetusPackageId || '',
        cetusGlobalConfigId: this.config.cetusGlobalConfigId || '',
        naviPackageId: this.config.naviPackageId || '',
        naviStorageId: this.config.naviStorageId || '',
      },
    });

    // 创建 MCP Server
    this.server = new Server(
      {
        name: 'sui-intent-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupToolHandlers();
    this.server.onerror = (error) => console.error('[MCP Error]', error);
  }

  /**
   * 设置工具处理器
   */
  private setupToolHandlers(): void {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'parse_intent',
          description: '解析自然语言意图为跨协议执行计划',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '自然语言意图描述，例如："在Cetus上卖出100 SUI，然后在Navi上买入USDC，最后将收益转入0x..."',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'execute_plan',
          description: '执行跨协议计划',
          inputSchema: {
            type: 'object',
            properties: {
              planId: {
                type: 'string',
                description: '计划 ID（从 parse_intent 返回）',
              },
              plan: {
                type: 'object',
                description: '完整的计划对象（从 parse_intent 返回）',
              },
            },
            required: ['plan'],
          },
        },
        {
          name: 'cross_protocol_swap_and_deposit',
          description: '一站式跨协议操作：在 Cetus 上 Swap，然后在 Navi 上 Deposit，最后转账到指定地址',
          inputSchema: {
            type: 'object',
            properties: {
              fromToken: {
                type: 'string',
                description: '卖出的代币类型，例如 "SUI" 或 "0x2::sui::SUI"',
              },
              toToken: {
                type: 'string',
                description: '买入的代币类型，例如 "USDC" 或 "0x...::usdc::USDC"',
              },
              amount: {
                type: 'string',
                description: '卖出数量（人类可读格式，如 "100"）',
              },
              recipientAddress: {
                type: 'string',
                description: '最终收益接收地址（Sui 地址，以 0x 开头）',
              },
              slippage: {
                type: 'number',
                description: '滑点容忍度，例如 0.5 表示 0.5%',
                default: 0.5,
              },
            },
            required: ['fromToken', 'toToken', 'amount', 'recipientAddress'],
          },
        },
        {
          name: 'get_quote',
          description: '获取跨协议操作的报价估算',
          inputSchema: {
            type: 'object',
            properties: {
              protocol: {
                type: 'string',
                description: '协议名称：cetus, navi, sui',
                enum: ['cetus', 'navi', 'sui'],
              },
              action: {
                type: 'string',
                description: '操作类型：swap, deposit, withdraw, borrow, transfer',
              },
              coinTypeIn: {
                type: 'string',
                description: '输入代币类型',
              },
              coinTypeOut: {
                type: 'string',
                description: '输出代币类型（仅 swap 需要）',
              },
              amount: {
                type: 'string',
                description: '数量',
              },
            },
            required: ['protocol', 'action', 'amount'],
          },
        },
      ],
    }));

    // 处理工具调用
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'parse_intent':
            return await this.handleParseIntent(args);
          case 'execute_plan':
            return await this.handleExecutePlan(args);
          case 'cross_protocol_swap_and_deposit':
            return await this.handleCrossProtocolSwapAndDeposit(args);
          case 'get_quote':
            return await this.handleGetQuote(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`,
            );
        }
      } catch (error: any) {
        console.error(`[Tool Error] ${name}:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * 处理 parse_intent 工具调用
   */
  private async handleParseIntent(args: any): Promise<any> {
    const { query } = args;

    if (!query || typeof query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'query is required and must be a string');
    }

    const plan = await this.orchestrator.parseIntent(query);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(plan, null, 2),
        },
      ],
    };
  }

  /**
   * 处理 execute_plan 工具调用
   */
  private async handleExecutePlan(args: any): Promise<any> {
    const { plan } = args;

    if (!plan) {
      throw new McpError(ErrorCode.InvalidParams, 'plan is required');
    }

    const result = await this.orchestrator.executePlan(plan as CrossProtocolPlan, '0xplaceholder');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理 cross_protocol_swap_and_deposit 工具调用
   *
   * 一站式完成：
   * 1. 在 Cetus 上 Swap（卖出 A，买入 B）
   * 2. 在 Navi 上 Deposit（存入 B）
   * 3. 将剩余收益转入指定地址
   */
  private async handleCrossProtocolSwapAndDeposit(args: any): Promise<any> {
    const { fromToken, toToken, amount, recipientAddress, slippage = 0.5 } = args;

    if (!fromToken || !toToken || !amount || !recipientAddress) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'fromToken, toToken, amount, and recipientAddress are required',
      );
    }

    // 构建意图查询
    const query = `在Cetus上卖出${amount} ${fromToken}兑换成${toToken}，然后在Navi上存入${toToken}，最后将收益转入${recipientAddress}`;

    // 解析意图
    const plan = await this.orchestrator.parseIntent(query);

    // 更新滑点参数
    if (plan.steps[0]?.protocol === 'cetus') {
      const amountNum = BigInt(plan.steps[0].params.amount || '0');
      const slippageBps = BigInt(Math.floor(slippage * 100));
      const minimumReceived = (amountNum * (10000n - slippageBps)) / 10000n;
      plan.steps[0].params.minimumReceived = minimumReceived.toString();
    }

    // 执行计划
    const result = await this.orchestrator.executePlan(plan, recipientAddress);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              plan,
              result,
              summary: {
                operation: `Swap ${amount} ${fromToken} → ${toToken} → Deposit → Transfer`,
                status: result.success ? '✅ Success' : '❌ Failed',
                steps: result.stepResults.map((s: any) => ({
                  step: s.stepId,
                  protocol: s.protocol,
                  action: s.action,
                  status: s.success ? '✅' : '❌',
                  txDigest: s.txDigest,
                  duration: `${s.duration}ms`,
                  error: s.error,
                })),
                totalGasUsed: result.totalGasUsed,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  /**
   * 处理 get_quote 工具调用
   */
  private async handleGetQuote(args: any): Promise<any> {
    const { protocol, action, coinTypeIn, coinTypeOut, amount } = args;

    if (!protocol || !action || !amount) {
      throw new McpError(ErrorCode.InvalidParams, 'protocol, action, and amount are required');
    }

    // 获取适配器报价
    const adapter = (this.orchestrator as any).adapters?.get(protocol);
    if (!adapter) {
      throw new McpError(ErrorCode.InvalidParams, `No adapter found for protocol: ${protocol}`);
    }

    const quote = await adapter.getQuote({
      action,
      coinTypeIn,
      coinTypeOut,
      amount,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(quote, null, 2),
        },
      ],
    };
  }

  /**
   * 启动服务器
   */
  async run(): Promise<void> {
    // 初始化编排器
    await this.orchestrator.initialize();

    // 使用 stdio 传输
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('Sui Intent MCP Server running on stdio');
  }
}

// 启动
const server = new SuiIntentMCPServer();
server.run().catch(console.error);

export { SuiIntentMCPServer };
