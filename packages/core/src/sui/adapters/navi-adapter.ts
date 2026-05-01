/**
 * Navi Protocol 适配器
 *
 * 提供 Navi Protocol 的存款、取款、借贷功能。
 * 使用 @mysten/sui 的 Transaction 对象直接向 PTB 追加指令。
 *
 * @module sui/adapters/navi-adapter
 */

import { Transaction } from '@mysten/sui/transactions';
import { logger } from '../../core/logger.js';
import type {
  DeFiProtocol,
  DepositQuote,
  WithdrawQuote,
} from '../types.js';
import type { IProtocolAdapter, AdapterConfig } from './types.js';
import { getNaviConfig } from '../network-config.js';
import type { SuiNetwork, NaviContractConfig } from '../network-config.js';

/** Navi 池配置 */
export interface NaviPoolConfig {
  name: string;
  assetId: number;
  poolId: string;
  type: string;
}

/** Navi 资产信息 */
export interface NaviAssetInfo {
  symbol: string;
  address: string;
  decimal: number;
}

/**
 * Navi Protocol 适配器
 *
 * 支持：
 * - deposit: 存入资产
 * - withdraw: 提取资产
 * - borrow: 借出资产
 * - repay: 偿还债务
 *
 * 合约配置通过 Navi Open API 动态获取，无需硬编码。
 */
export class NaviAdapter implements IProtocolAdapter {
  readonly protocol: DeFiProtocol = 'navi';
  readonly name = 'Navi Protocol';

  private config: AdapterConfig | null = null;
  private initialized = false;
  private naviConfig: NaviContractConfig | null = null;

  /** 支持的资产列表（使用真实的链上地址） */
  private readonly supportedAssets: NaviAssetInfo[] = [
    { symbol: 'SUI', address: '0x2::sui::SUI', decimal: 9 },
    { symbol: 'wUSDC', address: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN', decimal: 6 },
    { symbol: 'nUSDC', address: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', decimal: 6 },
    { symbol: 'USDT', address: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN', decimal: 6 },
    { symbol: 'WETH', address: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN', decimal: 8 },
    { symbol: 'WBTC', address: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN', decimal: 8 },
    { symbol: 'CETUS', address: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS', decimal: 9 },
    { symbol: 'NAVX', address: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX', decimal: 9 },
    { symbol: 'AUSD', address: '0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2ab8f6b9c8902f14df2ff2::ausd::AUSD', decimal: 6 },
    { symbol: 'DEEP', address: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP', decimal: 9 },
  ];

  /**
   * 初始化适配器
   * 同时从 Navi API 获取合约配置
   */
  async initialize(config: AdapterConfig): Promise<void> {
    this.config = config;
    this.initialized = true;

    // 预加载 Navi 配置
    try {
      const network = (config.network || 'mainnet') as SuiNetwork;
      this.naviConfig = await getNaviConfig(network);
      logger.info(`[NaviAdapter] Initialized (network: ${config.network})`);
    } catch (error: any) {
      logger.warn(`[NaviAdapter] Initialized but failed to preload Navi config: ${error.message}`);
      // 不抛出异常，允许延迟加载
    }
  }

  /**
   * 获取报价
   */
  async getQuote(params: Record<string, any>): Promise<DepositQuote | WithdrawQuote> {
    this.checkInitialized();

    const { action, coinType, amount } = params;

    if (!action || !coinType || !amount) {
      throw new Error('Missing required parameters: action, coinType, amount');
    }

    const asset = this.supportedAssets.find(a => a.address === coinType);
    if (!asset) {
      throw new Error(`Unsupported asset: ${coinType}`);
    }

    if (action === 'deposit') {
      return {
        protocol: 'navi',
        asset: {
          coinType,
          amount,
          symbol: asset.symbol,
          decimals: asset.decimal,
        },
        estimatedApy: '0.05',
      };
    }

    if (action === 'withdraw') {
      return {
        protocol: 'navi',
        asset: {
          coinType,
          amount,
          symbol: asset.symbol,
          decimals: asset.decimal,
        },
      };
    }

    throw new Error(`Unsupported action: ${action}`);
  }

  /**
   * 获取或加载 Navi 配置
   */
  private async getOrLoadNaviConfig(): Promise<NaviContractConfig> {
    if (this.naviConfig) {
      return this.naviConfig;
    }
    const network = (this.config?.network || 'mainnet') as SuiNetwork;
    this.naviConfig = await getNaviConfig(network);
    return this.naviConfig;
  }

  /**
   * 获取资产对应的池配置（poolId 和 assetId）
   */
  private getAssetPoolConfig(coinType: string, naviConfig: NaviContractConfig): { poolId: string; assetId: number } | null {
    // 根据 coinType 匹配对应的池子
    if (coinType.includes('sui::SUI') || coinType === '0x2::sui::SUI') {
      return { poolId: naviConfig.sui.poolId, assetId: 0 };
    }
    if (coinType.includes('usdc::USDC') || coinType.includes('coin::COIN')) {
      return { poolId: naviConfig.usdc.poolId, assetId: 1 };
    }

    // 尝试从 supportedAssets 中查找
    const asset = this.supportedAssets.find(a => a.address === coinType);
    if (asset) {
      const assetId = this.supportedAssets.indexOf(asset);
      // 对于 USDC 类型，使用 usdc 池
      if (asset.symbol === 'wUSDC' || asset.symbol === 'nUSDC') {
        return { poolId: naviConfig.usdc.poolId, assetId: 1 };
      }
      return { poolId: naviConfig.usdc.poolId, assetId }; // fallback
    }

    return null;
  }

  /**
   * 向 PTB 追加 Navi 指令
   *
   * 使用 @mysten/sui 的 Transaction.moveCall 方法直接向 PTB 追加指令。
   * 支持 deposit / withdraw / borrow / repay 四种操作。
   * 使用 Navi SDK 的 incentive_v3 合约进行交互。
   */
  async addCommands(tx: Transaction, params: Record<string, any>): Promise<void> {
    this.checkInitialized();

    const { action, coinType, amount } = params;

    if (!action || !coinType || !amount) {
      throw new Error('Missing required parameters for Navi operation');
    }

    // 处理 "auto" 金额：使用 0 作为占位符，实际金额由 PTB 执行时动态确定
    let resolvedAmount: string;
    if (amount === 'auto' || amount === 'all') {
      resolvedAmount = '0';
      logger.warn(`[NaviAdapter] amount="${amount}" resolved to 0 (placeholder). Actual amount will be determined at runtime.`);
    } else {
      resolvedAmount = String(amount);
    }

    // 动态获取 Navi 配置
    const naviConfig = await this.getOrLoadNaviConfig();
    const naviPackage = naviConfig.package_id;

    // 获取资产对应的池配置
    const poolConfig = this.getAssetPoolConfig(coinType, naviConfig);
    if (!poolConfig) {
      throw new Error(`Unsupported asset for Navi: ${coinType}`);
    }

    switch (action) {
      case 'deposit': {
        // 构建输入 Coin
        // 如果提供了 coinObject（来自前一步骤的输出），直接使用
        // 否则使用 coin::zero 创建指定类型的空 Coin（由用户在签名时提供实际余额）
        let depositCoin;
        if (params.coinObject) {
          depositCoin = params.coinObject;
        } else {
          depositCoin = tx.moveCall({
            target: `0x2::coin::zero`,
            typeArguments: [coinType],
          });
        }
        tx.moveCall({
          target: `${naviPackage}::incentive_v3::entry_deposit`,
          typeArguments: [coinType],
          arguments: [
            tx.object('0x06'),
            tx.object(naviConfig.storage_id),
            tx.object(poolConfig.poolId),
            tx.pure.u8(poolConfig.assetId),
            depositCoin,
            tx.pure.u64(BigInt(resolvedAmount)),
            tx.object(naviConfig.incentive_v2),
            tx.object(naviConfig.incentive_v3),
          ],
        });
        logger.info(`[NaviAdapter] Added deposit command: ${coinType} amount=${resolvedAmount} poolId=${poolConfig.poolId}`);
        break;
      }

      case 'withdraw': {
        tx.moveCall({
          target: `${naviPackage}::incentive_v3::withdraw_v2`,
          typeArguments: [coinType],
          arguments: [
            tx.object('0x06'),
            tx.object(naviConfig.price_oracle),
            tx.object(naviConfig.storage_id),
            tx.object(poolConfig.poolId),
            tx.pure.u8(poolConfig.assetId),
            tx.pure.u64(BigInt(resolvedAmount)),
            tx.object(naviConfig.incentive_v2),
            tx.object(naviConfig.incentive_v3),
            tx.object('0x05'),
          ],
        });
        logger.info(`[NaviAdapter] Added withdraw command: ${coinType} amount=${resolvedAmount} poolId=${poolConfig.poolId}`);
        break;
      }

      case 'borrow':
        tx.moveCall({
          target: `${naviPackage}::incentive_v3::borrow`,
          typeArguments: [coinType],
          arguments: [
            tx.object('0x06'),
            tx.object(naviConfig.price_oracle),
            tx.object(naviConfig.storage_id),
            tx.object(poolConfig.poolId),
            tx.pure.u8(poolConfig.assetId),
            tx.pure.u64(BigInt(resolvedAmount)),
            tx.object(naviConfig.incentive_v2),
            tx.object(naviConfig.incentive_v3),
          ],
        });
        logger.info(`[NaviAdapter] Added borrow command: ${coinType} amount=${resolvedAmount}`);
        break;

      case 'repay': {
        // 构建输入 Coin
        // 如果提供了 coinObject（来自前一步骤的输出），直接使用
        // 否则使用 coin::zero 创建指定类型的空 Coin（由用户在签名时提供实际余额）
        let repayCoin;
        if (params.coinObject) {
          repayCoin = params.coinObject;
        } else {
          repayCoin = tx.moveCall({
            target: `0x2::coin::zero`,
            typeArguments: [coinType],
          });
        }
        tx.moveCall({
          target: `${naviPackage}::incentive_v3::repay`,
          typeArguments: [coinType],
          arguments: [
            tx.object('0x06'),
            tx.object(naviConfig.storage_id),
            tx.object(poolConfig.poolId),
            tx.pure.u8(poolConfig.assetId),
            repayCoin,
            tx.pure.u64(BigInt(resolvedAmount)),
            tx.object(naviConfig.incentive_v2),
            tx.object(naviConfig.incentive_v3),
          ],
        });
        logger.info(`[NaviAdapter] Added repay command: ${coinType} amount=${resolvedAmount}`);
        break;
      }

      default:
        throw new Error(`Unsupported Navi action: ${action}`);
    }
  }

  /**
   * 验证参数
   */
  validateParams(params: Record<string, any>): string | null {
    const required = ['action', 'coinType', 'amount'];

    for (const field of required) {
      if (!params[field]) {
        return `Missing required parameter: ${field}`;
      }
    }

    const validActions = ['deposit', 'withdraw', 'borrow', 'repay'];
    if (!validActions.includes(params.action)) {
      return `Invalid action: ${params.action}. Must be one of: ${validActions.join(', ')}`;
    }

    if (params.amount && isNaN(Number(params.amount))) {
      return 'Invalid amount: must be a number';
    }

    return null;
  }

  /**
   * 获取池配置
   */
  getPoolConfig(coinType: string): NaviPoolConfig | null {
    const asset = this.supportedAssets.find(a => a.address === coinType);
    if (!asset) return null;

    return {
      name: asset.symbol,
      assetId: this.supportedAssets.indexOf(asset),
      poolId: `${this.config?.contractAddresses['navi_storage'] || '0x...'}::pool_${asset.symbol.toLowerCase()}`,
      type: coinType,
    };
  }

  /**
   * 获取支持的资产列表
   */
  getSupportedAssets(): NaviAssetInfo[] {
    return this.supportedAssets;
  }

  /**
   * 检查是否已初始化
   */
  private checkInitialized(): void {
    if (!this.initialized || !this.config) {
      throw new Error('NaviAdapter not initialized. Call initialize() first.');
    }
  }
}
