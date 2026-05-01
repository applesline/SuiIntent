/**
 * Sui 区块链跨协议编排的类型定义
 */

/** 支持的 DeFi 协议 */
export type DeFiProtocol = 'cetus' | 'navi' | 'sui' | 'aftermath' | 'turbos' | 'bluefin';

/** 资产数量（使用 string 避免 JS 精度问题） */
export interface AssetAmount {
  coinType: string;   // 例如: "0x2::sui::SUI" 或 "0x...::coin::COIN"
  amount: string;      // 大数表示
  decimals?: number;   // 精度
  symbol?: string;     // 符号
}

/** 跨协议步骤的资产流信息 */
export interface AssetFlow {
  inputAssets: AssetAmount[];
  outputAssets: AssetAmount[];
}

/** 跨协议执行步骤 */
export interface CrossProtocolStep {
  id: string;
  protocol: DeFiProtocol;
  action: string;
  description: string;
  params: Record<string, any>;
  dependsOn: string[];
  assetFlow?: AssetFlow;
}

/** 跨协议执行计划 */
export interface CrossProtocolPlan {
  id: string;
  query: string;
  steps: CrossProtocolStep[];
  canMergeToPTB: boolean;
  summary: string;
  estimatedGas?: string;
}

/** Swap 报价 */
export interface SwapQuote {
  protocol: DeFiProtocol;
  fromToken: AssetAmount;
  toToken: AssetAmount;
  priceImpact: string;
  minimumReceived: string;
  route?: string[];
}

/** 存款报价 */
export interface DepositQuote {
  protocol: DeFiProtocol;
  asset: AssetAmount;
  estimatedApy?: string;
  shares?: string;
}

/** 提款报价 */
export interface WithdrawQuote {
  protocol: DeFiProtocol;
  asset: AssetAmount;
  shares?: string;
}

/** 执行结果 */
export interface CrossProtocolResult {
  success: boolean;
  planId: string;
  stepResults: CrossProtocolStepResult[];
  txDigest?: string;
  error?: string;
  totalGasUsed?: string;
}

/** 单步执行结果 */
export interface CrossProtocolStepResult {
  stepId: string;
  protocol: DeFiProtocol;
  action: string;
  success: boolean;
  txDigest?: string;
  assetChanges?: AssetChange[];
  error?: string;
  duration: number;
}

/** 资产变更 */
export interface AssetChange {
  coinType: string;
  before: string;
  after: string;
  delta: string;
}

/** Sui 客户端配置 */
export interface SuiClientConfig {
  rpcUrl: string;
  network: 'mainnet' | 'testnet' | 'devnet' | 'localnet';
  privateKey?: string;
}

/** 合约地址配置 */
export interface ContractAddresses {
  cetus: {
    packageId: string;
    globalConfigId: string;
    pools: Record<string, string>;
  };
  navi: {
    packageId: string;
    storageId: string;
    reserves: Record<string, string>;
  };
}
