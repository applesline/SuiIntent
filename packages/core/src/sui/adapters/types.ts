/**
 * 协议适配器共享类型
 *
 * 重构后使用 @mysten/sui 的 Transaction 对象作为 PTB 构建单元。
 * 适配器通过 addCommands 直接向 Transaction 追加 MoveCall 指令。
 */

import type { Transaction } from '@mysten/sui/transactions';
import type {
  DeFiProtocol,
  SwapQuote,
  DepositQuote,
  WithdrawQuote,
} from '../types.js';

/** 适配器配置 */
export interface AdapterConfig {
  /** RPC URL（可选，默认使用公共节点） */
  rpcUrl?: string;
  /** 网络 */
  network: 'mainnet' | 'testnet' | 'devnet' | 'localnet';
  /** 合约地址 */
  contractAddresses: Record<string, string>;
}

/** 适配器接口 */
export interface IProtocolAdapter {
  readonly protocol: DeFiProtocol;
  readonly name: string;

  /** 获取报价 */
  getQuote(params: Record<string, any>): Promise<SwapQuote | DepositQuote | WithdrawQuote>;

  /**
   * 向 PTB 添加指令
   * 使用 @mysten/sui 的 Transaction 对象直接追加 MoveCall 等指令。
   * 适配器不应自行构建完整的 Transaction，而是通过 addCommands 追加。
   */
  addCommands(tx: Transaction, params: Record<string, any>): Promise<void>;

  /** 验证参数 */
  validateParams(params: Record<string, any>): string | null;

  /** 初始化适配器 */
  initialize(config: AdapterConfig): Promise<void>;
}
