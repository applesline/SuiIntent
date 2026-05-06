/**
 * Coin 类型解析器
 *
 * 通过链上 RPC 动态获取 Cetus 和 Navi 支持的代币列表，
 * 将代币简写（如 "USDC"、"wUSDC"、"SUI"）解析为完整的链上地址。
 *
 * 数据来源：
 * - Cetus: 通过 RPC 查询 coin_list 对象的动态字段
 * - Navi: 通过 Navi Open API 动态获取
 *
 * @module sui/coin-type-resolver
 */

import { logger } from '../core/logger.js';
import { getCetusConfig, getRpcUrl, type SuiNetwork } from './network-config.js';

/** 代币信息 */
export interface CoinInfo {
  /** 代币符号（如 "USDC"、"SUI"） */
  symbol: string;
  /** 完整的链上类型地址（如 "0x2::sui::SUI"） */
  coinType: string;
  /** 小数位数 */
  decimals: number;
  /** 代币名称（如 "USD Coin"） */
  name: string;
}

/** Cetus coin_list 动态字段中的 Coin 对象 */
interface CetusCoinObject {
  coin_type: { fields: { name: string } };
  name: string;
  symbol: string;
  decimals: number;
  logo_url: string;
  project_url: string;
  coingecko_id: string;
}

/**
 * Coin 类型解析器
 *
 * 单例模式，缓存代币列表，避免重复查询。
 */
export class CoinTypeResolver {
  private static instances: Map<string, CoinTypeResolver> = new Map();

  private network: SuiNetwork;
  /** 缓存：从链上获取的代币列表 */
  private coinCache: Map<string, CoinInfo> | null = null;
  /** 内置默认代币列表（快速路径，无需等待异步加载） */
  private defaultCoins: Map<string, CoinInfo>;
  private lastFetchTime = 0;
  private readonly cacheTTL = 5 * 60 * 1000; // 5 分钟缓存
  /** 是否已启动后台刷新 */
  private backgroundRefreshStarted = false;

  private constructor(network: SuiNetwork) {
    this.network = network;
    // 立即使用内置默认映射，确保同步方法可用
    this.defaultCoins = this.buildDefaultCoins();
    this.coinCache = this.defaultCoins;
  }

  /**
   * 获取 CoinTypeResolver 实例（单例）
   */
  static getInstance(network: SuiNetwork): CoinTypeResolver {
    const key = network;
    if (!CoinTypeResolver.instances.has(key)) {
      CoinTypeResolver.instances.set(key, new CoinTypeResolver(network));
    }
    return CoinTypeResolver.instances.get(key)!;
  }

  /**
   * 清除缓存（强制下次重新获取）
   */
  clearCache(): void {
    this.coinCache = this.defaultCoins;
    this.lastFetchTime = 0;
  }

  /**
   * 同步解析代币简写为完整的链上地址
   *
   * 使用内置默认映射，无需等待异步加载。
   * 适用于需要在同步上下文中解析的场景。
   *
   * @param symbol - 代币简写（如 "USDC"、"wUSDC"、"SUI"）
   * @returns 完整的链上类型地址，如果无法解析则返回 null
   */
  resolveSync(symbol: string): string | null {
    if (!symbol) return null;

    // 如果已经是完整的代币类型（包含 ::），且不包含占位符 "..."
    if (symbol.includes('::') && !symbol.includes('...')) {
      return symbol;
    }

    const coins = this.coinCache || this.defaultCoins;
    const upperSymbol = symbol.toUpperCase();

    // 精确匹配（大小写不敏感）
    const exactMatch = coins.get(upperSymbol);
    if (exactMatch) return exactMatch.coinType;

    // 模糊匹配：如果 symbol 包含在某个代币的 symbol 中
    for (const [key, info] of coins) {
      if (key.includes(upperSymbol) || upperSymbol.includes(key)) {
        return info.coinType;
      }
    }

    // 回退：如果包含 ::，保持原样
    if (symbol.includes('::')) return symbol;

    // 回退到 SUI 命名空间下的默认格式
    return `0x2::${symbol.toLowerCase()}::${symbol.toUpperCase()}`;
  }

  /**
   * 异步解析代币简写为完整的链上地址
   *
   * 优先从链上获取最新数据，如果失败则回退到内置映射。
   *
   * @param symbol - 代币简写（如 "USDC"、"wUSDC"、"SUI"）
   * @returns 完整的链上类型地址，如果无法解析则返回 null
   */
  async resolve(symbol: string): Promise<string | null> {
    if (!symbol) return null;

    // 如果已经是完整的代币类型（包含 ::），且不包含占位符 "..."
    if (symbol.includes('::') && !symbol.includes('...')) {
      return symbol;
    }

    // 触发后台刷新（如果尚未启动）
    this.ensureBackgroundRefresh();

    const coins = await this.getCoins();
    if (!coins) return null;

    const upperSymbol = symbol.toUpperCase();

    // 精确匹配（大小写不敏感）
    const exactMatch = coins.get(upperSymbol);
    if (exactMatch) return exactMatch.coinType;

    // 模糊匹配
    for (const [key, info] of coins) {
      if (key.includes(upperSymbol) || upperSymbol.includes(key)) {
        return info.coinType;
      }
    }

    // 回退
    if (symbol.includes('::')) return symbol;
    return `0x2::${symbol.toLowerCase()}::${symbol.toUpperCase()}`;
  }

  /**
   * 同步获取代币的小数位数
   */
  getDecimalsSync(symbol: string): number {
    if (!symbol) return 9;

    const coins = this.coinCache || this.defaultCoins;
    const upperSymbol = symbol.toUpperCase();
    const info = coins.get(upperSymbol);
    if (info) return info.decimals;

    // 常见代币的默认小数位数
    const defaultDecimals: Record<string, number> = {
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
    return defaultDecimals[upperSymbol] ?? 9;
  }

  /**
   * 异步获取代币的小数位数
   */
  async getDecimals(symbol: string): Promise<number> {
    if (!symbol) return 9;

    this.ensureBackgroundRefresh();
    const coins = await this.getCoins();
    if (!coins) return 9;

    const upperSymbol = symbol.toUpperCase();
    const info = coins.get(upperSymbol);
    if (info) return info.decimals;

    return this.getDecimalsSync(symbol);
  }

  /**
   * 获取所有代币列表
   */
  async getCoins(): Promise<Map<string, CoinInfo> | null> {
    // 检查缓存是否有效
    if (this.coinCache && Date.now() - this.lastFetchTime < this.cacheTTL) {
      return this.coinCache;
    }

    try {
      const coins = await this.fetchCoinsFromChain();
      this.coinCache = coins;
      this.lastFetchTime = Date.now();
      logger.info(`[CoinTypeResolver] Fetched ${coins.size} coins from ${this.network}`);
      return coins;
    } catch (error: any) {
      logger.error(`[CoinTypeResolver] Failed to fetch coins: ${error.message}`);
      // 如果缓存中有旧数据，返回旧数据
      if (this.coinCache) {
        return this.coinCache;
      }
      // 否则返回内置的默认映射
      return this.defaultCoins;
    }
  }

  /**
   * 确保后台刷新已启动
   * 在首次异步调用时触发链上数据获取，不阻塞当前调用
   */
  private ensureBackgroundRefresh(): void {
    if (this.backgroundRefreshStarted) return;
    this.backgroundRefreshStarted = true;

    // 如果缓存已过期，在后台异步刷新
    if (Date.now() - this.lastFetchTime >= this.cacheTTL) {
      this.getCoins().catch(err => {
        logger.warn(`[CoinTypeResolver] Background refresh failed: ${err.message}`);
      });
    }
  }

  /**
   * 通过 RPC 查询 Cetus 的 coin_list 对象，获取所有代币
   */
  private async fetchCoinsFromChain(): Promise<Map<string, CoinInfo>> {
    const rpcUrl = getRpcUrl(this.network);
    const cetusConfig = getCetusConfig(this.network);
    const coinListHandle = cetusConfig.coin_list_handle;

    if (!coinListHandle) {
      throw new Error(`Cetus coin_list_handle not found for network: ${this.network}`);
    }

    const coins = new Map<string, CoinInfo>();

    // 分页查询所有动态字段
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const params: any[] = [coinListHandle, cursor, 50];
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getDynamicFields',
          params,
        }),
      });

      const json = await response.json() as any;
      const data = json?.result?.data || [];
      const nextCursor = json?.result?.nextCursor;

      // 获取每个动态字段的详细信息
      for (const field of data) {
        try {
          const objectId = field.objectId;
          if (!objectId) continue;

          const objResponse = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'sui_getObject',
              params: [objectId, { showContent: true }],
            }),
          });

          const objJson = await objResponse.json() as any;
          const content = objJson?.result?.data?.content;
          if (!content || content.dataType !== 'moveObject') continue;

          const value = content.fields?.value?.fields as CetusCoinObject | undefined;
          if (!value) continue;

          // 从 coin_type 中提取完整的代币类型地址
          const coinTypeRaw = value.coin_type?.fields?.name;
          if (!coinTypeRaw) continue;

          // 标准化地址（去除前导零）
          const coinType = this.normalizeCoinType(coinTypeRaw);
          const symbol = value.symbol?.toUpperCase() || '';
          const name = value.name || '';
          const decimals = value.decimals ?? 9;

          if (symbol && coinType) {
            coins.set(symbol, { symbol, coinType, decimals, name });
          }
        } catch {
          // 跳过单个字段的查询失败
          continue;
        }
      }

      cursor = nextCursor || null;
      hasMore = !!nextCursor;
    }

    // 确保 SUI 始终存在
    if (!coins.has('SUI')) {
      coins.set('SUI', {
        symbol: 'SUI',
        coinType: '0x2::sui::SUI',
        decimals: 9,
        name: 'Sui',
      });
    }

    return coins;
  }

  /**
   * 标准化 coin type 地址
   * 将 0000000000000000000000000000000000000000000000000000000000000002::sui::SUI 简化为 0x2::sui::SUI
   */
  private normalizeCoinType(coinType: string): string {
    return coinType.replace(
      /(?:0x)?([0-9a-fA-F]{40,64})/g,
      (match, hex) => {
        const trimmed = hex.replace(/^0+/, '');
        return `0x${trimmed || '0'}`;
      }
    );
  }

  /**
   * 构建内置的默认代币映射（作为 fallback 和快速路径）
   */
  private buildDefaultCoins(): Map<string, CoinInfo> {
    const coins = new Map<string, CoinInfo>();

    if (this.network === 'testnet') {
      coins.set('SUI', { symbol: 'SUI', coinType: '0x2::sui::SUI', decimals: 9, name: 'Sui' });
      coins.set('USDC', { symbol: 'USDC', coinType: '0x14a71d857b34677a7d57e0feb303df1adb515a37780645ab763d42ce8d1a5e48::usdc::USDC', decimals: 6, name: 'USD Coin' });
      coins.set('WUSDC', { symbol: 'WUSDC', coinType: '0x14a71d857b34677a7d57e0feb303df1adb515a37780645ab763d42ce8d1a5e48::usdc::USDC', decimals: 6, name: 'Wrapped USDC' });
      coins.set('USDT', { symbol: 'USDT', coinType: '0x14a71d857b34677a7d57e0feb303df1adb515a37780645ab763d42ce8d1a5e48::usdt::USDT', decimals: 6, name: 'Tether USD' });
      coins.set('CETUS', { symbol: 'CETUS', coinType: '0x14a71d857b34677a7d57e0feb303df1adb515a37780645ab763d42ce8d1a5e48::cetus::CETUS', decimals: 9, name: 'Cetus' });
      coins.set('ETH', { symbol: 'ETH', coinType: '0xbd22966ee345483662ec067201c5b648fefe97121382836bbcb836d25124ec6c::eth::ETH', decimals: 8, name: 'Ether' });
      coins.set('WAL', { symbol: 'WAL', coinType: '0xbd22966ee345483662ec067201c5b648fefe97121382836bbcb836d25124ec6c::wal::WAL', decimals: 8, name: 'Walrus' });
      coins.set('DEEP', { symbol: 'DEEP', coinType: '0xbd22966ee345483662ec067201c5b648fefe97121382836bbcb836d25124ec6c::deep::DEEP', decimals: 9, name: 'DeepBook' });
      coins.set('HAWAL', { symbol: 'HAWAL', coinType: '0xbd22966ee345483662ec067201c5b648fefe97121382836bbcb836d25124ec6c::hawal::HAWAL', decimals: 8, name: 'HaWaL' });
      coins.set('NBTC', { symbol: 'NBTC', coinType: '0x5419f6e223f18a9141e91a42286f2783eee27bf2667422c2100afc7b2296731b::nbtc::NBTC', decimals: 8, name: 'Navi BTC' });
    } else {
      coins.set('SUI', { symbol: 'SUI', coinType: '0x2::sui::SUI', decimals: 9, name: 'Sui' });
      coins.set('USDC', { symbol: 'USDC', coinType: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN', decimals: 6, name: 'USD Coin' });
      coins.set('WUSDC', { symbol: 'WUSDC', coinType: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN', decimals: 6, name: 'Wrapped USDC' });
      coins.set('NUSDC', { symbol: 'NUSDC', coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', decimals: 6, name: 'Navi USDC' });
      coins.set('USDT', { symbol: 'USDT', coinType: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN', decimals: 6, name: 'Tether USD' });
      coins.set('CETUS', { symbol: 'CETUS', coinType: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS', decimals: 9, name: 'Cetus' });
      coins.set('WETH', { symbol: 'WETH', coinType: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN', decimals: 8, name: 'Wrapped Ether' });
      coins.set('WBTC', { symbol: 'WBTC', coinType: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN', decimals: 8, name: 'Wrapped Bitcoin' });
      coins.set('NAVX', { symbol: 'NAVX', coinType: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX', decimals: 9, name: 'NAVX' });
      coins.set('AUSD', { symbol: 'AUSD', coinType: '0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2ab8f6b9c8902f14df2ff2::ausd::AUSD', decimals: 6, name: 'AUSD' });
      coins.set('DEEP', { symbol: 'DEEP', coinType: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP', decimals: 9, name: 'DeepBook' });
    }

    return coins;
  }
}
