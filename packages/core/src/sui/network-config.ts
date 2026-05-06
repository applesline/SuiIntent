/**
 * Sui 网络合约地址配置
 *
 * 集中管理 Cetus、Navi 等 DeFi 协议在不同网络（mainnet/testnet）上的合约地址。
 * 数据来源：
 * - Cetus: @cetusprotocol/cetus-sui-clmm-sdk 中的 clmmMainnet / clmmTestnet 配置
 * - Navi: 通过 Navi Open API (https://open-api.naviprotocol.io) 动态获取
 *
 * @module sui/network-config
 */

/** 网络类型 */
export type SuiNetwork = 'mainnet' | 'testnet';

/** Cetus 合约配置 */
export interface CetusContractConfig {
  /** cetus_config package_id */
  cetus_package: string;
  /** clmm_pool package_id */
  clmm_pool: string;
  /** clmm_pool.published_at */
  clmm_pool_published_at: string;
  /** integrate package_id */
  integrate_package: string;
  /** integrate.published_at（包含 router 模块） */
  integrate_published_at: string;
  /** global_config_id（从 SDKConfig 中提取） */
  global_config_id: string;
  /** pools_id（池子列表 ID） */
  pools_id: string;
  /** coin_list_id（代币列表对象 ID） */
  coin_list_id: string;
  /** coin_list_handle（代币列表动态字段句柄） */
  coin_list_handle: string;
}

/** Navi 合约配置（从 Navi Open API 动态获取） */
export interface NaviContractConfig {
  /** Navi 协议 package ID */
  package_id: string;
  /** Storage ID */
  storage_id: string;
  /** Price Oracle ID */
  price_oracle: string;
  /** Reserve Parent ID */
  reserve_parent_id: string;
  /** Incentive V2 ID */
  incentive_v2: string;
  /** Incentive V3 ID */
  incentive_v3: string;
  /** USDC 池信息 */
  usdc: {
    poolId: string;
    reserveObjectId: string;
    supplyBalanceParentId: string;
  };
  /** SUI 池信息 */
  sui: {
    poolId: string;
    reserveObjectId: string;
    supplyBalanceParentId: string;
  };
}

/** 完整网络配置 */
export interface NetworkContracts {
  cetus: CetusContractConfig;
  navi: NaviContractConfig;
}

// ============================================================
// Mainnet 配置
// ============================================================

/** Cetus Mainnet 配置（从 @cetusprotocol/cetus-sui-clmm-sdk 提取） */
const CETUS_MAINNET: CetusContractConfig = {
  cetus_package: '0x95b8d278b876cae22206131fb9724f701c9444515813042f54f0a426c9a3bc2f',
  clmm_pool: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb',
  clmm_pool_published_at: '0x75b2e9ecad34944b8d0c874e568c90db0cf9437f0d7392abfd4cb902972f3e40',
  integrate_package: '0x996c4d9480708fb8b92aa7acf819fb0497b5ec8e65ba06601cae2fb6db3312c3',
  integrate_published_at: '0xb2db7142fa83210a7d78d9c12ac49c043b3cbbd482224fea6e3da00aa5a5ae2d',
  global_config_id: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f',
  pools_id: '0xf699e7f2276f5c9a75944b37a0c5b5d9ddfd2471bf6242483b03ab2887d198d0',
  coin_list_id: '0x8cbc11d9e10140db3d230f50b4d30e9b721201c0083615441707ffec1ef77b23',
  coin_list_handle: '0x49136005e90e28c4695419ed4194cc240603f1ea8eb84e62275eaff088a71063',
};

/** Navi Mainnet 配置（从 navi-sdk 提取） */
const NAVI_MAINNET: NaviContractConfig = {
  package_id: '0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb',
  storage_id: '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe',
  price_oracle: '0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef',
  reserve_parent_id: '0xe6d4c6610b86ce7735ea754596d71d72d10c7980b5052fc3c8cdf8d09fea9b4b',
  incentive_v2: '0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c',
  incentive_v3: '0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80',
  usdc: {
    poolId: '0xa02a98f9c88db51c6f5efaaf2261c81f34dd56d86073387e0ef1805ca22e39c8',
    reserveObjectId: '0xeb3903f7748ace73429bd52a70fff278aac1725d3b58afa781f25ce3450ac203',
    supplyBalanceParentId: '0x8d0a4467806458052d577c8cd2be6031e972f2b8f5f77fce98aa12cd85330da9',
  },
  sui: {
    poolId: '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5',
    reserveObjectId: '0xab644b5fd11aa11e930d1c7bc903ef609a9feaf9ffe1b23532ad8441854fbfaf',
    supplyBalanceParentId: '0x589c83af4b035a3bc64c40d9011397b539b97ea47edf7be8f33d643606bf96f8',
  },
};

// ============================================================
// Testnet 配置
// ============================================================

/** Cetus Testnet 配置（从 @cetusprotocol/cetus-sui-clmm-sdk 提取） */
const CETUS_TESTNET: CetusContractConfig = {
  cetus_package: '0xf5ff7d5ba73b581bca6b4b9fa0049cd320360abd154b809f8700a8fd3cfaf7ca',
  clmm_pool: '0x0c7ae833c220aa73a3643a0d508afa4ac5d50d97312ea4584e35f9eb21b9df12',
  clmm_pool_published_at: '0x85e61285a10efc6602ab00df70a0c06357c384ef4c5633ecf73016df1500c704',
  integrate_package: '0x2918cf39850de6d5d94d8196dc878c8c722cd79db659318e00bff57fbb4e2ede',
  integrate_published_at: '0x19dd42e05fa6c9988a60d30686ee3feb776672b5547e328d6dab16563da65293',
  global_config_id: '0x9774e359588ead122af1c7e7f64e14ade261cfeecdb5d0eb4a5b3b4c8ab8bd3e',
  pools_id: '0x50eb61dd5928cec5ea04711a2e9b72e5237e79e9fbcd2ce3d5469dc8708e0ee2',
  coin_list_id: '0x257eb2ba592a5480bba0a97d05338fab17cc3283f8df6998a0e12e4ab9b84478',
  coin_list_handle: '0x3204350fc603609c91675e07b8f9ac0999b9607d83845086321fca7f469de235',
};

// ============================================================
// Navi 配置 - 动态获取
// ============================================================

/**
 * Navi API 返回的原始配置格式
 */
interface NaviApiConfig {
  package: string;
  storage: string;
  incentiveV2: string;
  incentiveV3: string;
  priceOracle: string;
  reserveParentId: string;
  [key: string]: any;
}

/**
 * Navi API 返回的原始 pool 格式
 */
interface NaviApiPool {
  id: number;
  suiCoinType: string;
  token: { symbol: string };
  contract: { pool: string };
  reserveObjectId?: string;
  supplyBalanceParentId?: string;
  [key: string]: any;
}

/**
 * 从 Navi Open API 获取配置
 *
 * @param network - 网络类型
 * @returns Navi 合约配置
 */
async function fetchNaviConfigFromApi(network: SuiNetwork): Promise<NaviContractConfig> {
  // Navi API 使用 env=dev 作为 testnet 环境，env=prod 作为 mainnet 环境
  const env = network === 'testnet' ? 'dev' : 'prod';
  const sdkVersion = '1.4.3';

  // 获取合约配置
  const configUrl = `https://open-api.naviprotocol.io/api/navi/config?env=${env}&sdk=${sdkVersion}&market=main`;
  const configResponse = await fetch(configUrl);
  if (!configResponse.ok) {
    throw new Error(`Failed to fetch Navi config from API: ${configResponse.statusText}`);
  }
  const configData: { data: NaviApiConfig } = await configResponse.json();
  const apiConfig = configData.data;

  // 获取 pool 信息
  const poolsUrl = `https://open-api.naviprotocol.io/api/navi/pools?env=${env}&sdk=${sdkVersion}&market=main`;
  const poolsResponse = await fetch(poolsUrl);
  if (!poolsResponse.ok) {
    throw new Error(`Failed to fetch Navi pools from API: ${poolsResponse.statusText}`);
  }
  const poolsData: { data: NaviApiPool[] } = await poolsResponse.json();
  const pools = poolsData.data;

  // 查找 SUI 和 USDC 的 pool 信息
  const suiPool = pools.find(p => p.id === 0);
  const usdcPool = pools.find(p => p.id === 1);

  if (!suiPool || !usdcPool) {
    throw new Error(`Failed to find SUI/USDC pools in Navi API response for network: ${network}`);
  }

  return {
    package_id: apiConfig.package,
    storage_id: apiConfig.storage,
    price_oracle: apiConfig.priceOracle,
    reserve_parent_id: apiConfig.reserveParentId,
    incentive_v2: apiConfig.incentiveV2,
    incentive_v3: apiConfig.incentiveV3,
    usdc: {
      poolId: usdcPool.contract.pool,
      reserveObjectId: usdcPool.reserveObjectId || '0x0',
      supplyBalanceParentId: usdcPool.supplyBalanceParentId || '0x0',
    },
    sui: {
      poolId: suiPool.contract.pool,
      reserveObjectId: suiPool.reserveObjectId || '0x0',
      supplyBalanceParentId: suiPool.supplyBalanceParentId || '0x0',
    },
  };
}

/**
 * Navi 配置缓存
 */
let naviConfigCache: { mainnet: NaviContractConfig | null; testnet: NaviContractConfig | null } = {
  mainnet: NAVI_MAINNET, // mainnet 使用硬编码配置（已验证可用）
  testnet: null,
};

/**
 * 获取 Navi 配置
 *
 * 优先使用缓存，如果缓存中没有则从 API 获取。
 * mainnet 使用硬编码配置（已验证可用），testnet 从 API 动态获取。
 *
 * @param network - 网络类型
 * @returns Navi 合约配置
 */
export async function getNaviConfig(network: SuiNetwork): Promise<NaviContractConfig> {
  if (network === 'mainnet') {
    return naviConfigCache.mainnet!;
  }

  // testnet: 从 API 动态获取
  if (!naviConfigCache.testnet) {
    try {
      naviConfigCache.testnet = await fetchNaviConfigFromApi('testnet');
    } catch (error: any) {
      throw new Error(
        `Navi Protocol is not available on testnet. Failed to fetch config: ${error.message}. ` +
        'Please use mainnet for Navi operations.'
      );
    }
  }
  return naviConfigCache.testnet;
}

/**
 * 清除 Navi 配置缓存（强制下次重新获取）
 */
export function clearNaviConfigCache(): void {
  naviConfigCache.testnet = null;
}

// ============================================================
// 网络配置映射
// ============================================================

/** 所有网络的 Cetus 合约配置 */
const CETUS_CONTRACTS: Record<SuiNetwork, CetusContractConfig> = {
  mainnet: CETUS_MAINNET,
  testnet: CETUS_TESTNET,
};

/**
 * 获取指定网络的 Cetus 配置
 */
export function getCetusConfig(network: SuiNetwork): CetusContractConfig {
  return CETUS_CONTRACTS[network];
}

/**
 * 获取指定网络的 RPC URL
 */
export function getRpcUrl(network: SuiNetwork): string {
  return network === 'mainnet'
    ? 'https://fullnode.mainnet.sui.io:443'
    : 'https://fullnode.testnet.sui.io:443';
}
