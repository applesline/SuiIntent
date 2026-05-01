/**
 * Sui 原生适配器
 *
 * 提供 Sui 区块链的原生操作，如转账。
 * 使用 @mysten/sui 的 Transaction 对象直接向 PTB 追加指令。
 *
 * @module sui/adapters/sui-adapter
 */

import { Transaction } from '@mysten/sui/transactions';
import { logger } from '../../core/logger.js';
import type {
  DeFiProtocol,
} from '../types.js';
import type { IProtocolAdapter, AdapterConfig } from './types.js';

/**
 * Sui 原生适配器
 *
 * 支持：
 * - transfer: 转账 SUI 或代币
 */
export class SuiAdapter implements IProtocolAdapter {
  readonly protocol: DeFiProtocol = 'sui';
  readonly name = 'Sui Native';

  private config: AdapterConfig | null = null;
  private initialized = false;

  /**
   * 初始化适配器
   */
  async initialize(config: AdapterConfig): Promise<void> {
    this.config = config;
    this.initialized = true;
    logger.info(`[SuiAdapter] Initialized (network: ${config.network})`);
  }

  /**
   * 获取报价
   */
  async getQuote(params: Record<string, any>): Promise<any> {
    this.checkInitialized();

    const { action, coinType, amount } = params;

    if (action === 'transfer') {
      return {
        protocol: 'sui',
        action: 'transfer',
        coinType: coinType || '0x2::sui::SUI',
        amount: amount || '0',
      };
    }

    throw new Error(`Unsupported action: ${action}`);
  }

  /**
   * 向 PTB 追加 Sui 原生指令
   *
   * 使用 @mysten/sui 的 Transaction 方法直接追加指令。
   * 支持 transfer 操作。
   */
  async addCommands(tx: Transaction, params: Record<string, any>): Promise<void> {
    this.checkInitialized();

    const { action, recipient, amount, coinType } = params;

    if (!action) {
      throw new Error('Missing required parameter: action');
    }

    switch (action) {
      case 'transfer':
        if (!recipient) {
          throw new Error('Missing required parameter: recipient');
        }
        if (!amount) {
          throw new Error('Missing required parameter: amount for transfer');
        }
        // 从 gas coin 中分割出指定金额的 coin
        const [transferCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
        // 将分割出的 coin 转给 recipient
        tx.transferObjects(
          [transferCoin],
          tx.pure.address(recipient),
        );
        logger.info(`[SuiAdapter] Added transfer command: ${amount} to ${recipient}`);
        break;

      default:
        throw new Error(`Unsupported Sui action: ${action}`);
    }
  }

  /**
   * 验证参数
   */
  validateParams(params: Record<string, any>): string | null {
    if (!params.action) {
      return 'Missing required parameter: action';
    }

    if (params.action === 'transfer' && !params.recipient) {
      return 'Missing required parameter: recipient for transfer';
    }

    return null;
  }

  /**
   * 检查是否已初始化
   */
  private checkInitialized(): void {
    if (!this.initialized || !this.config) {
      throw new Error('SuiAdapter not initialized. Call initialize() first.');
    }
  }
}
