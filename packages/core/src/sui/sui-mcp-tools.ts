/**
 * Sui DeFi MCP Tools 注册模块
 *
 * 将 Cetus、Navi、Sui 适配器包装为 @intentorch/core 的 Tool 类型，
 * 供 CloudIntentEngine 通过 LLM function calling 自动发现和调用。
 *
 * 每个 Tool 对应一个 DeFi 操作，LLM 通过 Tool 描述理解用户意图
 * 并生成结构化执行计划。
 *
 * @module sui/sui-mcp-tools
 */

import type { Tool } from '../mcp/types.js';

/**
 * 获取 Sui DeFi MCP Tools 列表
 *
 * 这些 Tool 会被注册到 CloudIntentEngine，LLM 通过 function calling
 * 自动选择合适的 Tool 来满足用户意图。
 */
export function getSuiMCPTools(): Tool[] {
  return [
    // ==================== Cetus DEX Tools ====================
    {
      name: 'cetus_swap',
      description: `【执行类工具 (EXECUTION)】在 Cetus DEX 上执行真实的代币兑换交易（Swap）。
这是执行买卖操作的唯一正确工具。不要使用查询类工具来生成执行计划。
支持任意两种代币之间的兑换，自动路由最优池子。
示例：在 Cetus 上卖出 SUI 买入 USDC，或交换 USDC 为 CETUS。

参数说明：
- coinTypeIn: 输入代币的类型（如 "SUI" 或 "USDC"）
- coinTypeOut: 输出代币的类型（如 "USDC"）
- amount: 输入金额（最小单位，如 1000000000 = 1 SUI）
- byAmountIn: true 表示固定输入金额，false 表示固定输出金额
- slippage: 滑点容忍度（如 0.005 = 0.5%）
- poolId: 可选，指定交易池 ID`,
      inputSchema: {
        type: 'object',
        properties: {
          coinTypeIn: {
            type: 'string',
            description: '输入代币的类型，如 "SUI" 或 "0x2::sui::SUI"',
          },
          coinTypeOut: {
            type: 'string',
            description: '输出代币的类型，如 "USDC"',
          },
          amount: {
            type: 'string',
            description: '金额（最小单位），如 "1000000000" = 1 SUI',
          },
          byAmountIn: {
            type: 'boolean',
            description: 'true=固定输入金额, false=固定输出金额',
            default: true,
          },
          slippage: {
            type: 'number',
            description: '滑点容忍度，如 0.005 = 0.5%',
            default: 0.005,
          },
          poolId: {
            type: 'string',
            description: '可选，指定交易池 ID',
          },
        },
        required: ['coinTypeIn', 'coinTypeOut', 'amount'],
      },
    },
    {
      name: 'cetus_view_quote',
      description: `【仅查询 (READ-ONLY)】仅查看 Cetus DEX 上的兑换报价，不执行交易。
严禁将此工具加入到需要执行交易的执行计划中。
参数说明：
- coinTypeIn: 输入代币的完整类型
- coinTypeOut: 输出代币的完整类型
- amount: 输入金额（最小单位）
- byAmountIn: true=固定输入, false=固定输出`,
      inputSchema: {
        type: 'object',
        properties: {
          coinTypeIn: {
            type: 'string',
            description: '输入代币的完整类型',
          },
          coinTypeOut: {
            type: 'string',
            description: '输出代币的完整类型',
          },
          amount: {
            type: 'string',
            description: '输入金额（最小单位）',
          },
          byAmountIn: {
            type: 'boolean',
            description: 'true=固定输入, false=固定输出',
            default: true,
          },
        },
        required: ['coinTypeIn', 'coinTypeOut', 'amount'],
      },
    },
    {
      name: 'cetus_view_pools',
      description: `【仅查询 (READ-ONLY)】仅查看 Cetus DEX 上可用的交易池列表，不执行交易。
严禁将此工具加入到执行计划中。
参数说明：
- coinTypeA: 可选，代币 A 的类型
- coinTypeB: 可选，代币 B 的类型`,
      inputSchema: {
        type: 'object',
        properties: {
          coinTypeA: {
            type: 'string',
            description: '可选，代币 A 的类型',
          },
          coinTypeB: {
            type: 'string',
            description: '可选，代币 B 的类型',
          },
        },
      },
    },

    // ==================== Navi Protocol Tools ====================
    {
      name: 'navi_deposit',
      description: `【执行类工具 (EXECUTION)】在 Navi Protocol 上执行存入资产的真实交易。
存入指定代币到 Navi 借贷池，赚取存款利息。

参数说明：
- coinType: 要存入的代币类型
- amount: 存入金额（最小单位）`,
      inputSchema: {
        type: 'object',
        properties: {
          coinType: {
            type: 'string',
            description: '要存入的代币类型，如 "0x2::sui::SUI"',
          },
          amount: {
            type: 'string',
            description: '存入金额（最小单位）',
          },
        },
        required: ['coinType', 'amount'],
      },
    },
    {
      name: 'navi_withdraw',
      description: `【执行类工具 (EXECUTION)】从 Navi Protocol 执行提取资产的真实交易。
提取之前存入的资产。

参数说明：
- coinType: 要提取的代币类型
- amount: 提取金额（最小单位）`,
      inputSchema: {
        type: 'object',
        properties: {
          coinType: {
            type: 'string',
            description: '要提取的代币类型',
          },
          amount: {
            type: 'string',
            description: '提取金额（最小单位）',
          },
        },
        required: ['coinType', 'amount'],
      },
    },
    {
      name: 'navi_borrow',
      description: `【执行类工具 (EXECUTION)】从 Navi Protocol 执行借出资产的真实交易。
使用已存入的资产作为抵押，借出指定代币。

参数说明：
- coinType: 要借出的代币类型
- amount: 借出金额（最小单位）`,
      inputSchema: {
        type: 'object',
        properties: {
          coinType: {
            type: 'string',
            description: '要借出的代币类型',
          },
          amount: {
            type: 'string',
            description: '借出金额（最小单位）',
          },
        },
        required: ['coinType', 'amount'],
      },
    },
    {
      name: 'navi_repay',
      description: `【执行类工具 (EXECUTION)】偿还 Navi Protocol 借款的真实交易。
归还之前借出的资产。

参数说明：
- coinType: 要偿还的代币类型
- amount: 偿还金额（最小单位）`,
      inputSchema: {
        type: 'object',
        properties: {
          coinType: {
            type: 'string',
            description: '要偿还的代币类型',
          },
          amount: {
            type: 'string',
            description: '偿还金额（最小单位）',
          },
        },
        required: ['coinType', 'amount'],
      },
    },

    // ==================== Sui Native Tools ====================
    {
      name: 'sui_transfer',
      description: `【执行类工具 (EXECUTION)】在 Sui 区块链上执行转账交易。
将指定代币发送到目标地址。

参数说明：
- recipient: 接收地址（0x 开头）
- amount: 转账金额（最小单位），"all" 表示全部余额
- coinType: 代币类型，默认 SUI`,
      inputSchema: {
        type: 'object',
        properties: {
          recipient: {
            type: 'string',
            description: '接收地址，以 0x 开头',
          },
          amount: {
            type: 'string',
            description: '转账金额（最小单位），"all" 表示全部余额',
          },
          coinType: {
            type: 'string',
            description: '代币类型，默认 "0x2::sui::SUI"',
            default: '0x2::sui::SUI',
          },
        },
        required: ['recipient'],
      },
    },
    {
      name: 'sui_view_balance',
      description: `【仅查询 (READ-ONLY)】仅查询 Sui 地址的代币余额，不执行交易。
参数说明：
- address: 要查询的地址
- coinType: 可选，代币类型，默认 SUI`,
      inputSchema: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: '要查询的地址',
          },
          coinType: {
            type: 'string',
            description: '可选，代币类型，默认 SUI',
            default: '0x2::sui::SUI',
          },
        },
        required: ['address'],
      },
    },
  ];
}
