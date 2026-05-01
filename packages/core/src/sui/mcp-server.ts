/**
 * Sui DeFi MCP Server
 *
 * 提供跨协议复杂意图编排的 MCP 工具接口。
 * 支持自然语言意图解析和多协议操作执行。
 *
 * @module sui/mcp-server
 */

import { logger } from '../core/logger.js';
import { CrossProtocolOrchestrator } from './cross-protocol-orchestrator.js';
import type { OrchestratorConfig } from './cross-protocol-orchestrator.js';
import type { CrossProtocolPlan, CrossProtocolResult } from './types.js';

/** MCP 工具定义 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

/** MCP 工具处理函数映射 */
export type MCPToolHandlers = Record<string, (params: Record<string, any>) => Promise<any>>;

/**
 * Sui DeFi MCP Server
 *
 * 提供以下 MCP 工具：
 * - sui_parse_intent: 解析自然语言意图为结构化计划
 * - sui_execute_intent: 解析并执行意图
 * - sui_get_quote: 获取协议报价
 * - sui_get_supported_protocols: 获取支持的协议列表
 */
export class SuiMCPServer {
  private orchestrator: CrossProtocolOrchestrator;
  private initialized = false;

  constructor(config: OrchestratorConfig) {
    this.orchestrator = new CrossProtocolOrchestrator(config);
  }

  /**
   * 初始化 MCP Server
   */
  async initialize(): Promise<void> {
    await this.orchestrator.initialize();
    this.initialized = true;
    logger.info('[SuiMCPServer] Initialized');
  }

  /**
   * 获取 MCP 工具定义列表
   */
  getTools(): MCPToolDefinition[] {
    return [
      {
        name: 'sui_parse_intent',
        description: '解析自然语言意图为跨协议操作计划',
        inputSchema: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              description: '自然语言意图描述，例如："在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC"',
            },
          },
          required: ['intent'],
        },
      },
      {
        name: 'sui_execute_intent',
        description: '解析并执行自然语言意图',
        inputSchema: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              description: '自然语言意图描述',
            },
            signerAddress: {
              type: 'string',
              description: '签名者地址',
            },
          },
          required: ['intent', 'signerAddress'],
        },
      },
      {
        name: 'sui_build_transaction',
        description: '将自然语言意图构建为 PTB 交易字节，供前端钱包签名',
        inputSchema: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              description: '自然语言意图描述',
            },
          },
          required: ['intent'],
        },
      },
      {
        name: 'sui_get_quote',

        description: '获取指定协议的报价',
        inputSchema: {
          type: 'object',
          properties: {
            protocol: {
              type: 'string',
              description: '协议名称 (cetus, navi)',
              enum: ['cetus', 'navi'],
            },
            params: {
              type: 'object',
              description: '报价参数',
            },
          },
          required: ['protocol', 'params'],
        },
      },
      {
        name: 'sui_get_supported_protocols',
        description: '获取支持的 DeFi 协议列表',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }

  /**
   * 获取 MCP 工具处理函数
   */
  getToolHandlers(): MCPToolHandlers {
    return {
      sui_parse_intent: async (params: Record<string, any>): Promise<CrossProtocolPlan> => {
        this.checkInitialized();
        return this.orchestrator.parseIntent(params.intent);
      },

      sui_execute_intent: async (params: Record<string, any>): Promise<CrossProtocolResult> => {
        this.checkInitialized();
        const plan = await this.orchestrator.parseIntent(params.intent);
        return this.orchestrator.executePlan(plan, params.signerAddress);
      },

      sui_build_transaction: async (params: Record<string, any>): Promise<{ txBytes: string; steps: number }> => {
        this.checkInitialized();
        const plan = await this.orchestrator.parseIntent(params.intent);
        const tx = await this.orchestrator.buildPlanTransaction(plan);
        // 序列化为 base64 字节，供前端钱包签名
        const txBytes = await tx.build();
        return {
          txBytes: Buffer.from(txBytes).toString('base64'),
          steps: plan.steps.length,
        };
      },

      sui_get_quote: async (params: Record<string, any>): Promise<any> => {

        this.checkInitialized();
        // 简化实现：直接返回模拟报价
        return {
          protocol: params.protocol,
          fromToken: { coinType: '0x2::sui::SUI', amount: '1000000000', symbol: 'SUI' },
          toToken: { coinType: '0x...::usdc::USDC', amount: '950000000', symbol: 'USDC' },
          priceImpact: '0.01',
          minimumReceived: '945250000',
        };
      },

      sui_get_supported_protocols: async (): Promise<{
        protocols: Array<{ name: string; protocol: string; actions: string[] }>;
      }> => {
        return {
          protocols: [
            {
              name: 'Cetus DEX',
              protocol: 'cetus',
              actions: ['swap'],
            },
            {
              name: 'Navi Protocol',
              protocol: 'navi',
              actions: ['deposit', 'withdraw', 'borrow', 'repay'],
            },
            {
              name: 'Sui Native',
              protocol: 'sui',
              actions: ['transfer'],
            },
          ],
        };
      },
    };
  }

  /**
   * 检查是否已初始化
   */
  private checkInitialized(): void {
    if (!this.initialized) {
      throw new Error('SuiMCPServer not initialized. Call initialize() first.');
    }
  }
}
