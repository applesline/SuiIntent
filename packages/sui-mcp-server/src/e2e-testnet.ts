/**
 * Sui 测试网端到端测试
 *
 * 这个脚本演示了如何使用 Sui 测试网执行跨协议流程：
 * 1. 创建临时钱包
 * 2. 从 faucet 获取测试 SUI
 * 3. 查询 Cetus 和 Navi 在测试网上的合约
 * 4. 构建并执行跨协议 PTB
 *
 * 运行方式:
 *   cd packages/sui-mcp-server
 *   npx tsx src/e2e-testnet.ts
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { requestSuiFromFaucetV0, getFaucetHost } from '@mysten/sui.js/faucet';

// ============================================================
// 测试网配置
// ============================================================

/** Sui 测试网 RPC */
const TESTNET_RPC = getFullnodeUrl('testnet');

/** Cetus 测试网合约地址 (截至 2025 年) */
const CETUS_TESTNET = {
  packageId: '0x0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e',
  globalConfigId: '0x0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f',
  poolId: '0x1010101010101010101010101010101010101010', // SUI/USDC 池
};

/** Navi 测试网合约地址 (截至 2025 年) */
const NAVI_TESTNET = {
  packageId: '0x1111111111111111111111111111111111111111',
  storageId: '0x1212121212121212121212121212121212121212',
  reserveId: '0x1313131313131313131313131313131313131313', // USDC 储备
};

// ============================================================
// 工具函数
// ============================================================

/** 等待指定毫秒 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 格式化 SUI 金额 (从 MIST 转换为 SUI) */
function formatSui(mist: string | bigint): string {
  const value = typeof mist === 'string' ? BigInt(mist) : mist;
  const whole = value / 1_000_000_000n;
  const fraction = value % 1_000_000_000n;
  return `${whole}.${fraction.toString().padStart(9, '0')}`;
}

/** 将 SUI 转换为 MIST */
function toMist(sui: number): string {
  return (BigInt(Math.floor(sui * 1_000_000_000))).toString();
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log('🚀 Sui 测试网端到端测试\n');
  console.log('='.repeat(60));

  // 1. 创建 Sui 客户端
  console.log('\n📡 连接到 Sui 测试网...');
  const client = new SuiClient({ url: TESTNET_RPC });
  const networkInfo = await client.getChainIdentifier();
  console.log(`   链标识: ${networkInfo}`);

  // 2. 创建临时钱包
  console.log('\n🔑 创建临时钱包...');
  const keypair = new Ed25519Keypair();
  const address = keypair.toSuiAddress();
  console.log(`   地址: ${address}`);

  // 3. 从 faucet 获取测试 SUI
  console.log('\n💧 从 faucet 获取测试 SUI...');
  try {
    const faucetResponse = await requestSuiFromFaucetV0({
      host: getFaucetHost('testnet'),
      recipient: address,
    });
    console.log(`   Faucet 响应:`, JSON.stringify(faucetResponse).substring(0, 200));
  } catch (error: any) {
    console.log(`   Faucet 请求已发送 (可能需等待): ${error.message}`);
  }

  // 等待 faucet 到账
  console.log('\n⏳ 等待 faucet 到账...');
  let balance = '0';
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    try {
      const coins = await client.getCoins({ owner: address, coinType: '0x2::sui::SUI' });
      balance = coins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n).toString();
      if (BigInt(balance) > 0n) {
        console.log(`   ✅ 已收到 ${formatSui(balance)} SUI`);
        break;
      }
    } catch {}
    if (i % 5 === 0) console.log(`   等待中... (${(i + 1) * 2}s)`);
  }

  if (BigInt(balance) === 0n) {
    console.log('   ⚠️ 未收到 faucet 代币，使用模拟模式继续...');
  }

  // 4. 查询测试网上的合约信息
  console.log('\n🔍 查询测试网合约信息...');
  try {
    const cetusPackage = await client.getObject({
      id: CETUS_TESTNET.packageId,
      options: { showContent: true },
    });
    console.log(`   Cetus 包: ${cetusPackage.data?.content?.dataType || '未找到'}`);
  } catch (error: any) {
    console.log(`   Cetus 包查询失败: ${error.message}`);
  }

  try {
    const naviPackage = await client.getObject({
      id: NAVI_TESTNET.packageId,
      options: { showContent: true },
    });
    console.log(`   Navi 包: ${naviPackage.data?.content?.dataType || '未找到'}`);
  } catch (error: any) {
    console.log(`   Navi 包查询失败: ${error.message}`);
  }

  // 5. 构建跨协议 PTB
  console.log('\n📝 构建跨协议 PTB...');
  console.log('   流程: Cetus Swap (SUI → USDC) → Navi Deposit (USDC)');

  const ptb = new TransactionBlock();

  // 步骤 1: 准备 SUI 代币用于 Cetus swap
  const [swapCoin] = ptb.splitCoins(ptb.gas, [ptb.pure(toMist(0.1))]);

  // 步骤 2: Cetus Swap - SUI → USDC
  // 注意: 这是模拟调用，实际需要 Cetus 的准确合约接口
  const swapResult = ptb.moveCall({
    target: `${CETUS_TESTNET.packageId}::pool::swap`,
    arguments: [
      ptb.object(CETUS_TESTNET.poolId),     // pool
      swapCoin,                               // coin_in
      ptb.pure(toMist(0.1)),                  // amount_in
      ptb.pure('0'),                          // sqrt_price_limit (0 = no limit)
    ],
    typeArguments: [
      '0x2::sui::SUI',                       // coinTypeIn
      '0x...::usdc::USDC',                   // coinTypeOut (测试网 USDC)
    ],
  });

  // 步骤 3: Navi Deposit - 存入 USDC
  // 注意: 这是模拟调用，实际需要 Navi 的准确合约接口
  ptb.moveCall({
    target: `${NAVI_TESTNET.packageId}::storage::deposit`,
    arguments: [
      ptb.object(NAVI_TESTNET.storageId),     // storage
      ptb.object(NAVI_TESTNET.reserveId),     // reserve
      swapResult,                              // coin (swap 得到的 USDC)
      ptb.object('0x6'),                       // clock (Sui 系统对象)
    ],
    typeArguments: [
      '0x...::usdc::USDC',                   // coinType
    ],
  });

  // 步骤 4: 设置 Gas 预算
  ptb.setGasBudget(10_000_000); // 0.01 SUI

  console.log('\n   PTB 构建完成:');
  console.log(`   - Cetus Swap: ${CETUS_TESTNET.packageId}::pool::swap`);
  console.log(`   - Navi Deposit: ${NAVI_TESTNET.packageId}::storage::deposit`);
  console.log(`   - Gas Budget: 0.01 SUI`);

  // 6. 模拟执行 (不实际发送交易)
  console.log('\n🧪 模拟执行 PTB...');
  try {
    const dryRunResult = await client.dryRunTransactionBlock({
      transactionBlock: await ptb.build({ client }),
    });
    console.log(`   模拟执行成功!`);
    console.log(`   Gas 使用: ${dryRunResult.effects.gasUsed.computationCost}`);
    console.log(`   状态: ${dryRunResult.effects.status.status}`);
    if (dryRunResult.effects.status.status === 'success') {
      console.log(`   ✅ PTB 模拟执行通过!`);
    } else {
      console.log(`   ❌ PTB 模拟执行失败: ${dryRunResult.effects.status.error}`);
    }
  } catch (error: any) {
    console.log(`   模拟执行失败 (预期中，因为合约地址是占位符): ${error.message}`);
    console.log('   ℹ️  需要使用真实的 Cetus/Navi 测试网合约地址');
  }

  // 7. 总结
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 测试总结:\n');
  console.log(`   钱包地址: ${address}`);
  console.log(`   余额: ${formatSui(balance)} SUI`);
  console.log(`   Cetus 包: ${CETUS_TESTNET.packageId}`);
  console.log(`   Navi 包: ${NAVI_TESTNET.packageId}`);
  console.log(`   RPC: ${TESTNET_RPC}`);
  console.log('\n   ℹ️  注意: 合约地址是占位符，需要替换为实际的测试网地址');
  console.log('   ℹ️  可以通过以下方式获取实际地址:');
  console.log('     1. 访问 Cetus/Navi 官方文档获取测试网地址');
  console.log('     2. 使用 Sui Explorer 查询测试网上的合约');
  console.log('     3. 部署自己的测试合约\n');
}

main().catch(console.error);
