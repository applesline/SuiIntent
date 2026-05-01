/**
 * Cetus DEX 协议适配器
 *
 * 提供 Cetus DEX 的 Swap 报价和交易构建功能。
 * 使用 @mysten/sui 的 Transaction 对象直接向 PTB 追加指令。
 *
 * @module sui/adapters/cetus-adapter
 */

import { Transaction } from '@mysten/sui/transactions';
import { logger } from '../../core/logger.js';
import type {
  DeFiProtocol,
  SwapQuote,
} from '../types.js';
import type { IProtocolAdapter, AdapterConfig } from './types.js';
import { getCetusConfig, getRpcUrl } from '../network-config.js';
import type { SuiNetwork } from '../network-config.js';

/** Cetus 池信息 */
export interface CetusPoolInfo {
  poolId: string;
  coinTypeA: string;
  coinTypeB: string;
  currentSqrtPrice: string;
  currentTick: number;
  fee: number;
}

/**
 * Cetus DEX 适配器
 *
 * 支持：
 * - getQuote: 获取 Swap 报价
 * - addCommands: 向 PTB 追加 Swap 指令
 * - 滑点保护
 */
export class CetusAdapter implements IProtocolAdapter {
  readonly protocol: DeFiProtocol = 'cetus';
  readonly name = 'Cetus DEX';

  private config: AdapterConfig | null = null;
  private initialized = false;

  /**
   * 初始化适配器
   */
  async initialize(config: AdapterConfig): Promise<void> {
    this.config = config;
    this.initialized = true;
    logger.info(`[CetusAdapter] Initialized (network: ${config.network})`);
  }

  /**
   * 获取 Swap 报价
   */
  async getQuote(params: Record<string, any>): Promise<SwapQuote> {
    this.checkInitialized();

    const { coinTypeIn, coinTypeOut, amount, byAmountIn = true, slippage = 0.005 } = params;

    if (!coinTypeIn || !coinTypeOut || !amount) {
      throw new Error('Missing required parameters: coinTypeIn, coinTypeOut, amount');
    }

    // 处理 "auto" 金额：使用 0 作为占位符
    const resolvedAmount = (amount === 'auto' || amount === 'all') ? '0' : String(amount);

    // 简化报价计算（实际应调用链上 SDK）
    const amountNum = BigInt(resolvedAmount);
    const fee = 30n;
    const FEE_DENOMINATOR = 10000n;

    const feeAmount = (amountNum * fee) / FEE_DENOMINATOR;
    const amountAfterFee = amountNum - feeAmount;

    const outputAmount = amountAfterFee;
    const slippageBps = BigInt(Math.floor(slippage * 10000));


    return {
      protocol: 'cetus',
      fromToken: {
        coinType: coinTypeIn,
        amount: amount,
        symbol: this.getSymbol(coinTypeIn),
      },
      toToken: {
        coinType: coinTypeOut,
        amount: outputAmount.toString(),
        symbol: this.getSymbol(coinTypeOut),
      },
      priceImpact: '0.01',
      minimumReceived: ((outputAmount * (10000n - slippageBps)) / 10000n).toString(),
    };
  }

  /**
   * 解析池子 ID
   *
   * 如果 poolId 是 factory::Pools 对象（pools_id），则从链上查询具体的池子对象 ID。
   * 否则直接返回 poolId。
   *
   * @param poolId - 用户提供的 poolId
   * @param coinTypeA - 代币 A 类型
   * @param coinTypeB - 代币 B 类型
   * @returns 具体的池子对象 ID
   */
  private async resolvePoolId(
    poolId: string,
    coinTypeA: string,
    coinTypeB: string,
  ): Promise<string> {
    const network = (this.config?.network || 'testnet') as SuiNetwork;
    const cetusConfig = getCetusConfig(network);

    // 如果 poolId 等于 pools_id（factory::Pools 对象），需要查询具体的池子
    if (poolId === cetusConfig.pools_id) {
      logger.info(`[CetusAdapter] poolId is factory::Pools object, querying specific pool for ${coinTypeA} ↔ ${coinTypeB}`);

      try {
        const rpcUrl = getRpcUrl(network);

        // 使用 fetch 直接发送 RPC 请求，按时间正序查询（descending: false）
        // SuiJsonRpcClient 的 queryEvents 不支持 descending 参数，默认按时间倒序
        // 而 SUI ↔ USDC 等早期池子需要按时间正序才能查到
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'suix_queryEvents',
            params: [
              {
                MoveEventType: `${cetusConfig.clmm_pool}::factory::CreatePoolEvent`,
              },
              null,
              100,
              false, // descending: false = 时间正序
            ],
          }),
        });

        const json = await response.json() as any;
        const events = json?.result?.data || [];

        for (const event of events) {
          const fields = event.parsedJson as any;
          if (fields) {
            // 从事件中提取 coin_type_a 和 coin_type_b
            const coinTypeAFromEvent = this.extractCoinTypeFromEvent(fields.coin_type_a);
            const coinTypeBFromEvent = this.extractCoinTypeFromEvent(fields.coin_type_b);

            if (
              (coinTypeAFromEvent === coinTypeA && coinTypeBFromEvent === coinTypeB) ||
              (coinTypeAFromEvent === coinTypeB && coinTypeBFromEvent === coinTypeA)
            ) {
              logger.info(`[CetusAdapter] Found pool: ${fields.pool_id} for ${coinTypeA} ↔ ${coinTypeB}`);
              return fields.pool_id;
            }
          }
        }

        // 如果按时间正序没找到，再按时间倒序查询（最新的池子）
        logger.warn(`[CetusAdapter] Pool not found in ascending order, trying descending...`);
        const responseDesc = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'suix_queryEvents',
            params: [
              {
                MoveEventType: `${cetusConfig.clmm_pool}::factory::CreatePoolEvent`,
              },
              null,
              100,
              true, // descending: true = 时间倒序
            ],
          }),
        });

        const jsonDesc = await responseDesc.json() as any;
        const eventsDesc = jsonDesc?.result?.data || [];

        for (const event of eventsDesc) {
          const fields = event.parsedJson as any;
          if (fields) {
            const coinTypeAFromEvent = this.extractCoinTypeFromEvent(fields.coin_type_a);
            const coinTypeBFromEvent = this.extractCoinTypeFromEvent(fields.coin_type_b);

            if (
              (coinTypeAFromEvent === coinTypeA && coinTypeBFromEvent === coinTypeB) ||
              (coinTypeAFromEvent === coinTypeB && coinTypeBFromEvent === coinTypeA)
            ) {
              logger.info(`[CetusAdapter] Found pool: ${fields.pool_id} for ${coinTypeA} ↔ ${coinTypeB}`);
              return fields.pool_id;
            }
          }
        }

        throw new Error(`No pool found for ${coinTypeA} ↔ ${coinTypeB}`);
      } catch (error: any) {
        logger.error(`[CetusAdapter] Failed to resolve poolId: ${error.message}`);
        throw new Error(`Cannot resolve pool for swap: ${error.message}`);
      }
    }

    // 如果 poolId 不是 pools_id，直接返回
    return poolId;
  }

  /**
   * 从事件字段中提取 coin type
   * 事件中的 coin_type 可能是结构体标签格式
   */
  private extractCoinTypeFromEvent(coinTypeField: any): string {
    if (typeof coinTypeField === 'string') {
      return this.normalizeCoinType(coinTypeField);
    }
    if (coinTypeField && typeof coinTypeField === 'object') {
      // 尝试从结构体标签中提取
      const address = coinTypeField.address || '';
      const module = coinTypeField.module || '';
      const name = coinTypeField.name || '';
      if (address && module && name) {
        return this.normalizeCoinType(`${address}::${module}::${name}`);
      }
    }
    return this.normalizeCoinType(String(coinTypeField));
  }

  /**
   * 规范化 coin type 字符串
   * 将 0000000000000000000000000000000000000000000000000000000000000002::sui::SUI 简化为 0x2::sui::SUI
   * 将 0x0000000000000000000000000000000000000000000000000000000000000002 简化为 0x2
   */
  private normalizeCoinType(coinType: string): string {
    // 匹配地址部分（64字符十六进制，可能带 0x 前缀）
    return coinType.replace(
      /(?:0x)?([0-9a-fA-F]{40,64})/g,
      (match, hex) => {
        // 去除前导零
        const trimmed = hex.replace(/^0+/, '');
        return `0x${trimmed || '0'}`;
      }
    );
  }

  /**
   * 向 PTB 追加 Cetus Swap 指令
   *
   * 使用 @mysten/sui 的 Transaction.moveCall 方法直接向 PTB 追加指令。
   * 参考 Cetus SDK 实现：
   * - router::swap 需要两个单独的 Coin 参数（输入 Coin 和空输出 Coin）
   * - 返回两个 Coin（coinTypeA 和 coinTypeB 各一个）
   * - 对于 SUI 输入，使用 tx.splitCoins(tx.gas) 拆分
   * - 对于非 SUI 输入，使用 coinWithBalance 创建空 Coin
   */
  async addCommands(tx: Transaction, params: Record<string, any>): Promise<void> {
    this.checkInitialized();

    const {
      poolId,
      coinTypeIn,
      coinTypeOut,
      amount,
      minimumReceived,
      byAmountIn = true,
    } = params;

    if (!poolId || !coinTypeIn || !coinTypeOut || !amount) {
      throw new Error('Missing required parameters for Cetus swap');
    }

    // 根据网络自动选择合约地址
    const network = (this.config?.network || 'testnet') as SuiNetwork;
    const cetusConfig = getCetusConfig(network);

    // 解析具体的池子 ID（如果 poolId 是 factory::Pools 对象）
    const resolvedPoolId = await this.resolvePoolId(poolId, coinTypeIn, coinTypeOut);

    // 查询池子的链上类型，确定 CoinTypeA 和 CoinTypeB 的实际顺序
    // router::swap 的 typeArguments 必须与池子的 Pool<CoinTypeA, CoinTypeB> 类型完全匹配
    // 否则 tx.build() 会报 CommandArgumentError { kind: TypeMismatch }
    const { actualCoinTypeA, actualCoinTypeB } = await this.resolvePoolCoinTypes(resolvedPoolId, network);

    // 根据池子的实际类型确定 typeArguments 和 a2b 方向
    // 重要：typeArguments 必须与池子的 Pool<CoinTypeA, CoinTypeB> 类型完全匹配！
    // 否则 tx.build() 会报 CommandArgumentError { kind: TypeMismatch }
    //
    // router::swap 的语义：
    // - typeArguments = [CoinTypeA, CoinTypeB] 必须与池子类型 Pool<CoinTypeA, CoinTypeB> 一致
    // - 参数 3: Coin<CoinTypeA> - 当 a2b=true 时是输入，a2b=false 时是空的输出 Coin
    // - 参数 4: Coin<CoinTypeB> - 当 a2b=true 时是空的输出 Coin，a2b=false 时是输入
    // - a2b=true: 从 A 换到 B（输入 CoinTypeA，输出 CoinTypeB）
    // - a2b=false: 从 B 换到 A（输入 CoinTypeB，输出 CoinTypeA）
    let a2b: boolean;

    if (coinTypeIn === actualCoinTypeA) {
      // coinTypeIn 是池子的 A 代币，a2b=true 表示从 A 换到 B
      // typeArguments = [actualCoinTypeA, actualCoinTypeB]
      // 参数 3 (Coin<actualCoinTypeA>) = inputCoin (有余额)
      // 参数 4 (Coin<actualCoinTypeB>) = outputCoin (空的)
      a2b = true;
    } else if (coinTypeIn === actualCoinTypeB) {
      // coinTypeIn 是池子的 B 代币，a2b=false 表示从 B 换到 A
      // typeArguments = [actualCoinTypeA, actualCoinTypeB]
      // 参数 3 (Coin<actualCoinTypeA>) = outputCoin (空的)
      // 参数 4 (Coin<actualCoinTypeB>) = inputCoin (有余额)
      a2b = false;
    } else {
      throw new Error(
        `Coin type ${coinTypeIn} does not match pool's coin types (${actualCoinTypeA}, ${actualCoinTypeB})`
      );
    }

    logger.info(`[CetusAdapter] Pool ${resolvedPoolId} types: A=${actualCoinTypeA}, B=${actualCoinTypeB}, a2b=${a2b}`);

    // 使用 integrate package 中的 router::swap
    const integratePackage = cetusConfig.integrate_published_at;
    const globalConfigId = cetusConfig.global_config_id;

    // sqrtPriceLimit: 从池子中获取当前 sqrtPrice，基于滑点计算合理的价格范围
    // Cetus 的 flash_swap_internal 不接受 sqrtPriceLimit=0 或 u128::MAX
    // 0 会导致 abort code 11 (EInsufficientLiquidity)
    // u128::MAX 也会被合约拒绝
    // 正确做法：从池子中获取 current_sqrt_price，然后：
    // - a2b=true (从 A 换到 B): 使用 current_sqrt_price * (1 - slippage) 作为下限
    // - a2b=false (从 B 换到 A): 使用 current_sqrt_price * (1 + slippage) 作为上限
    const currentSqrtPrice = await this.getPoolCurrentSqrtPrice(resolvedPoolId, network);
    const slippageBps = BigInt(params.slippage ? Math.floor(Number(params.slippage) * 10000) : 100); // 默认 1%
    const sqrtPriceBigInt = BigInt(currentSqrtPrice);
    let sqrtPriceLimit: string;
    if (a2b) {
      // 从 A 换到 B：价格下降，sqrtPrice 下降
      // sqrtPriceLimit = currentSqrtPrice * (10000 - slippageBps) / 10000
      sqrtPriceLimit = ((sqrtPriceBigInt * (10000n - slippageBps)) / 10000n).toString();
    } else {
      // 从 B 换到 A：价格上涨，sqrtPrice 上涨
      // sqrtPriceLimit = currentSqrtPrice * (10000 + slippageBps) / 10000
      sqrtPriceLimit = ((sqrtPriceBigInt * (10000n + slippageBps)) / 10000n).toString();
    }
    logger.info(`[CetusAdapter] Using sqrtPriceLimit=${sqrtPriceLimit} (current=${currentSqrtPrice}, slippage=${slippageBps}bps, a2b=${a2b})`);
    const CLOCK_ADDRESS = '0x6';

    // 构建输入 Coin
    // 注意：如果 coinTypeIn 是 SUI，从 gas 拆分；否则使用 coin::zero 创建空 Coin
    // 因为 gas coin 是 SUI 类型，不能作为非 SUI 代币的输入
    let inputCoin;
    if (coinTypeIn === '0x2::sui::SUI') {
      inputCoin = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(amount))]);
    } else {
      // 对于非 SUI 代币，使用 coin::zero 创建指定类型的空 Coin
      // 实际余额由用户在交易签名时提供
      inputCoin = tx.moveCall({
        target: `0x2::coin::zero`,
        typeArguments: [coinTypeIn],
      });
    }

    // 构建空的输出 Coin（用于接收 swap 结果）
    // 使用 coin::zero 创建指定类型的空 Coin
    // 注意：不要传 arguments 参数，tx.moveCall 会自动注入 &mut TxContext
    const outputCoin = tx.moveCall({
      target: `0x2::coin::zero`,
      typeArguments: [coinTypeOut],
    });

    // 调用 router::swap
    // 参数: globalConfig, pool, coinA, coinB, a2b, byAmountIn, amount, sqrtPriceLimit, hasPartner, clock, txContext
    // 返回: (Coin<CoinTypeA>, Coin<CoinTypeB>)
    //
    // 重要：参数 3 (coinA) 和参数 4 (coinB) 的语义：
    // - coinA 是 Coin<CoinTypeA>（第一个类型参数的 Coin）
    // - coinB 是 Coin<CoinTypeB>（第二个类型参数的 Coin）
    // - 当 a2b=true: coinA 是输入（有余额），coinB 是空的输出 Coin
    // - 当 a2b=false: coinA 是空的输出 Coin，coinB 是输入（有余额）
    //
    // 所以需要根据 a2b 方向决定哪个 Coin 作为输入，哪个作为空的输出 Coin
    const coinA = a2b ? inputCoin : outputCoin;
    const coinB = a2b ? outputCoin : inputCoin;

    const [coinOutA, coinOutB] = tx.moveCall({
      target: `${integratePackage}::router::swap`,
      typeArguments: [actualCoinTypeA, actualCoinTypeB],
      arguments: [
        tx.object(globalConfigId),
        tx.object(resolvedPoolId),
        coinA,
        coinB,
        tx.pure.bool(a2b),
        tx.pure.bool(byAmountIn),
        tx.pure.u64(BigInt(amount)),
        tx.pure.u128(sqrtPriceLimit),
        tx.pure.bool(false), // hasPartner
        tx.object(CLOCK_ADDRESS),
      ],
    });

    // 根据 a2b 方向确定输出 Coin 和剩余 Coin
    // a2b=true: coinOutA 是剩余的 coinTypeIn, coinOutB 是换得的 coinTypeOut
    // a2b=false: coinOutA 是换得的 coinTypeOut, coinOutB 是剩余的 coinTypeIn
    const outputCoinRef = a2b ? coinOutB : coinOutA;
    const leftoverCoinRef = a2b ? coinOutA : coinOutB;

    // 将输出 Coin 引用保存到 params 中，供编排器后续步骤使用
    params._outputCoin = outputCoinRef;

    // 将剩余的 Coin 合并到 gas 中（如果 coinTypeIn 是 SUI）
    // 注意：Coin 没有 drop 能力，所有返回值都必须被使用
    // 使用 tx.add 直接添加 MergeCoins 命令，避免 this.object 的 Proxy 兼容性问题
    // valibot 的 is 函数可能无法正确处理 Proxy 对象（TransactionResult）
    // 因此我们手动创建一个普通的 NestedResult 对象，而不是使用 Proxy 对象
    if (coinTypeIn === '0x2::sui::SUI') {
      // SUI 可以合并到 gas coin
      // 手动创建 NestedResult 参数，避免 Proxy 兼容性问题
      const leftoverCoinArg = {
        $kind: "NestedResult" as const,
        NestedResult: leftoverCoinRef.NestedResult,
      };
      const { TransactionCommands } = await import('@mysten/sui/transactions');
      tx.add(TransactionCommands.MergeCoins(
        tx.gas,
        [leftoverCoinArg],
      ));
      logger.info(`[CetusAdapter] Merged leftover SUI coin into gas`);
    } else {
      // 非 SUI 代币，保存到 params 中，由编排器处理
      params._leftoverCoin = leftoverCoinRef;
      logger.info(`[CetusAdapter] Saved non-SUI leftover coin to params for orchestrator handling`);
    }

    logger.info(`[CetusAdapter] Added swap command: ${coinTypeIn} → ${coinTypeOut} (network: ${network})`);

  }

  /**
   * 验证参数
   */
  validateParams(params: Record<string, any>): string | null {
    const required = ['coinTypeIn', 'coinTypeOut', 'amount'];

    for (const field of required) {
      if (!params[field]) {
        return `Missing required parameter: ${field}`;
      }
    }

    if (params.amount && isNaN(Number(params.amount))) {
      return 'Invalid amount: must be a number';
    }

    return null;
  }

  /**
   * 获取池信息
   */
  async getPoolInfo(poolId: string): Promise<CetusPoolInfo> {
    return {
      poolId,
      coinTypeA: '0x2::sui::SUI',
      coinTypeB: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
      currentSqrtPrice: '1000000000000000',
      currentTick: 0,
      fee: 30,
    };
  }


  /**
   * 查询池子的链上类型，提取 Pool<CoinTypeA, CoinTypeB> 中的实际 CoinTypeA 和 CoinTypeB
   *
   * router::swap 的 typeArguments 必须与池子的 Pool<CoinTypeA, CoinTypeB> 类型完全匹配，
   * 否则 tx.build() 会报 CommandArgumentError { kind: TypeMismatch }。
   * 这个方法通过 RPC 查询池子对象的类型，提取实际的 CoinTypeA 和 CoinTypeB。
   *
   * @param poolId - 池子对象 ID
   * @param network - 网络类型
   * @returns 池子中实际的 CoinTypeA 和 CoinTypeB
   */
  private async resolvePoolCoinTypes(
    poolId: string,
    network: SuiNetwork,
  ): Promise<{ actualCoinTypeA: string; actualCoinTypeB: string }> {
    const rpcUrl = getRpcUrl(network);

    try {
      // 查询池子对象的类型信息
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sui_getObject',
          params: [
            poolId,
            {
              showType: true,
              showContent: false,
            },
          ],
        }),
      });

      const json = await response.json() as any;
      const result = json?.result?.data;

      if (!result || !result.type) {
        throw new Error(`Failed to get object type for pool ${poolId}`);
      }

      const objectType = result.type as string;
      logger.info(`[CetusAdapter] Pool ${poolId} object type: ${objectType}`);

      // 解析 Pool<CoinTypeA, CoinTypeB> 类型
      // 格式: PACKAGE::pool::Pool<COIN_TYPE_A, COIN_TYPE_B>
      const poolTypeMatch = objectType.match(/<(.+),\s*(.+)>$/);
      if (!poolTypeMatch) {
        throw new Error(`Cannot parse pool type from: ${objectType}`);
      }

      const rawCoinTypeA = poolTypeMatch[1].trim();
      const rawCoinTypeB = poolTypeMatch[2].trim();

      // 规范化 coin type
      const actualCoinTypeA = this.normalizeCoinType(rawCoinTypeA);
      const actualCoinTypeB = this.normalizeCoinType(rawCoinTypeB);

      logger.info(`[CetusAdapter] Resolved pool coin types: A=${actualCoinTypeA}, B=${actualCoinTypeB}`);

      return { actualCoinTypeA, actualCoinTypeB };
    } catch (error: any) {
      logger.error(`[CetusAdapter] Failed to resolve pool coin types: ${error.message}`);
      throw new Error(`Cannot resolve pool coin types for swap: ${error.message}`);
    }
  }

  /**
   * 从链上查询池子的当前 sqrtPrice
   *
   * 通过 RPC 查询池子对象的 current_sqrt_price 字段。
   * 用于计算合理的 sqrtPriceLimit，避免使用 u128::MAX 或 0 导致合约 abort。
   *
   * @param poolId - 池子对象 ID
   * @param network - 网络类型
   * @returns 当前 sqrtPrice 的字符串表示
   */
  private async getPoolCurrentSqrtPrice(
    poolId: string,
    network: SuiNetwork,
  ): Promise<string> {
    const rpcUrl = getRpcUrl(network);

    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sui_getObject',
          params: [
            poolId,
            {
              showType: false,
              showContent: true,
            },
          ],
        }),
      });

      const json = await response.json() as any;
      const result = json?.result?.data;

      if (!result || !result.content || !result.content.fields) {
        throw new Error(`Failed to get pool content for ${poolId}`);
      }

      const fields = result.content.fields;
      const currentSqrtPrice = fields.current_sqrt_price;

      if (!currentSqrtPrice) {
        throw new Error(`Pool ${poolId} has no current_sqrt_price field`);
      }

      logger.info(`[CetusAdapter] Pool ${poolId} current_sqrt_price: ${currentSqrtPrice}`);
      return String(currentSqrtPrice);
    } catch (error: any) {
      logger.error(`[CetusAdapter] Failed to get pool current sqrt price: ${error.message}`);
      // 如果查询失败，使用一个合理的默认值
      // 对于 SUI/USDC 池子，sqrtPrice 通常在 10^12 ~ 10^15 之间
      logger.warn(`[CetusAdapter] Using default sqrt price fallback`);
      return '1000000000000000';
    }
  }

  /**
   * 从 coinType 提取符号
   */
  private getSymbol(coinType: string): string {
    if (coinType === '0x2::sui::SUI') return 'SUI';
    const parts = coinType.split('::');
    return parts[parts.length - 1] || coinType;
  }

  /**
   * 检查是否已初始化
   */
  private checkInitialized(): void {
    if (!this.initialized || !this.config) {
      throw new Error('CetusAdapter not initialized. Call initialize() first.');
    }
  }
}
