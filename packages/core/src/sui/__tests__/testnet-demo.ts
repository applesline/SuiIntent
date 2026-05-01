/**
 * Sui 测试网真实交易演示脚本
 *
 * 本脚本使用 @mysten/sui SDK 实际连接到 Sui 测试网，
 * 执行真实的 SUI 转账交易，生成可在 Sui 浏览器上查看的交易记录。
 *
 * 前置条件：
 * 1. 需要一个有测试网 SUI 的钱包私钥
 * 2. 可以从 Sui 测试网水龙头获取测试币：https://faucet.sui.io/
 *
 * 运行方式：
 *   SUI_PRIVATE_KEY=<base64_private_key> npx tsx src/sui/__tests__/testnet-demo.ts
 *
 * 查看交易：
 *   https://testnet.suivision.xyz/tx/<txDigest>
 *   https://testnet.suiscan.xyz/tx/<txDigest>
 */

// @ts-ignore - tsx ESM resolution workaround
import { SuiJsonRpcClient as SuiClient } from '@mysten/sui/jsonRpc';
// @ts-ignore - tsx ESM resolution workaround
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
// @ts-ignore - tsx ESM resolution workaround
import { Transaction } from '@mysten/sui/transactions';
// @ts-ignore - tsx ESM resolution workaround
import { fromBase64, fromHex } from '@mysten/sui/utils';
// @ts-ignore - tsx ESM resolution workaround
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

// ============================================================
// 配置
// ============================================================
const SUI_TESTNET_RPC = 'https://fullnode.testnet.sui.io:443';
const EXPLORER_URL = 'https://testnet.suivision.xyz/tx';

// 测试网常用地址
const TESTNET_RECIPIENTS = [
  '0x0000000000000000000000000000000000000000000000000000000000000001', // 系统地址（仅用于演示）
];

// ============================================================
// 工具函数
// ============================================================

/**
 * 从环境变量获取私钥并创建签名者
 *
 * 支持两种私钥格式：
 * 1. Bech32 格式: "suiprivkey1qxxx..."（Sui CLI 导出格式）
 * 2. Base64 格式: 原始 32 字节私钥的 Base64 编码
 */
function getSigner(): Ed25519Keypair {
  const rawKey = process.env.SUI_PRIVATE_KEY;
  if (!rawKey) {
    console.log('\n⚠️  未设置 SUI_PRIVATE_KEY 环境变量');
    console.log('   将使用模拟模式演示交易构建流程\n');
    return null as any;
  }

  try {
    // 尝试 Bech32 格式 (suiprivkey1...)
    if (rawKey.startsWith('suiprivkey')) {
      const { secretKey } = decodeSuiPrivateKey(rawKey);
      return Ed25519Keypair.fromSecretKey(secretKey);
    }

    // 尝试 Hex 格式 (64位 hex 字符串)
    if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
      return Ed25519Keypair.fromSecretKey(fromHex(rawKey));
    }

    // 尝试 Base64 格式 (原始 32 字节私钥)
    const privateKeyBytes = fromBase64(rawKey);
    return Ed25519Keypair.fromSecretKey(privateKeyBytes.slice(0, 32));
  } catch (error: any) {
    console.error(`❌ 私钥解析失败: ${error.message}`);
    console.error(`   支持的格式:`);
    console.error(`   1. Bech32: suiprivkey1qxxx... (Sui CLI 导出格式)`);
    console.error(`   2. Hex:    64 位十六进制字符串`);
    console.error(`   3. Base64: 原始 32 字节私钥的 Base64 编码`);
    process.exit(1);
  }
}

/**
 * 创建 Sui 测试网客户端
 */
function createClient(): SuiClient {
  return new SuiClient({ url: SUI_TESTNET_RPC, network: 'testnet' });
}

/**
 * 格式化 SUI 金额（从 MIST 转换为 SUI）
 */
function formatSui(mist: bigint): string {
  return (Number(mist) / 1e9).toFixed(4);
}

// ============================================================
// 演示场景
// ============================================================

/**
 * 场景 1: 查询测试网账户余额
 */
async function demoCheckBalance(client: SuiClient, address: string) {
  console.log('\n📋 场景 1: 查询测试网账户余额');
  console.log('-'.repeat(60));

  try {
    const balance = await client.getBalance({
      owner: address,
      coinType: '0x2::sui::SUI',
    });

    console.log(`   地址: ${address}`);
    console.log(`   SUI 余额: ${formatSui(BigInt(balance.totalBalance))} SUI`);
    console.log(`   精确值: ${balance.totalBalance} MIST`);
    console.log(`   ✅ 余额查询成功`);
    return BigInt(balance.totalBalance);
  } catch (error: any) {
    console.error(`   ❌ 查询失败: ${error.message}`);
    return 0n;
  }
}

/**
 * 场景 2: 构建并模拟 SUI 转账交易（不实际发送）
 */
async function demoBuildTransferTx(client: SuiClient, sender: string) {
  console.log('\n📋 场景 2: 构建 SUI 转账交易（模拟 - 不实际发送）');
  console.log('-'.repeat(60));

  try {
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1_000_000)]);
    tx.transferObjects([coin], tx.pure.address(TESTNET_RECIPIENTS[0]));

    // 先构建交易字节
    const txBytes = await tx.build({ client });
    
    // 模拟交易（不实际发送）
    const dryRunResult = await client.dryRunTransactionBlock({
      transactionBlock: txBytes,
    });

    console.log(`   发送方: ${sender}`);
    console.log(`   接收方: ${TESTNET_RECIPIENTS[0]}`);
    console.log(`   金额: 0.001 SUI (1,000,000 MIST)`);
    console.log(`   模拟执行状态: ${dryRunResult.effects.status.status}`);
    console.log(`   Gas 消耗: ${dryRunResult.effects.gasUsed.computationCost} MIST`);
    console.log(`   ✅ 交易构建和模拟成功`);
    return tx;
  } catch (error: any) {
    console.error(`   ❌ 构建失败: ${error.message}`);
    return null;
  }
}

/**
 * 场景 3: 实际发送 SUI 转账交易到测试网
 */
async function demoSendTransferTx(
  client: SuiClient,
  signer: Ed25519Keypair,
  sender: string,
) {
  console.log('\n📋 场景 3: 发送 SUI 转账交易到测试网');
  console.log('-'.repeat(60));

  try {
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1_000_000)]);
    tx.transferObjects([coin], tx.pure.address(sender)); // 转给自己

    // 签名并发送
    const result = await client.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    });

    const txDigest = result.digest;
    console.log(`   ✅ 交易已发送到测试网!`);
    console.log(`   交易摘要: ${txDigest}`);
    console.log(`   查看交易: ${EXPLORER_URL}/${txDigest}`);
    console.log(`   状态: ${result.effects?.status.status}`);

    // 等待交易确认
    console.log(`   等待交易确认...`);
    const txResult = await client.waitForTransaction({
      digest: txDigest,
      options: { showEffects: true, showEvents: true },
    });
    console.log(`   确认状态: ${txResult.effects?.status.status}`);
    console.log(`   Gas 消耗: ${txResult.effects?.gasUsed.computationCost} MIST`);

    return txDigest;
  } catch (error: any) {
    console.error(`   ❌ 发送失败: ${error.message}`);
    return null;
  }
}

/**
 * 场景 4: 演示跨协议意图解析（使用编排器）
 */
async function demoCrossProtocolIntent() {
  console.log('\n📋 场景 4: 跨协议意图解析演示');
  console.log('-'.repeat(60));

  // 动态导入编排器
  const { CrossProtocolOrchestrator } = await import('../cross-protocol-orchestrator.js');

  const orchestrator = new CrossProtocolOrchestrator({
    network: 'testnet',
    contractAddresses: {
      cetus_package: '0x...',
      navi_package: '0x...',
      sui_system: '0x3',
    },
  });

  await orchestrator.initialize();

  // 演示 1: 单步 Swap
  console.log('\n   ▶ 演示 1: 解析 "在 Cetus 上卖出 SUI 买入 USDC"');
  const plan1 = await orchestrator.parseIntent('在 Cetus 上卖出 SUI 买入 USDC');
  console.log(`     步骤数: ${plan1.steps.length}`);
  console.log(`     描述: ${plan1.summary}`);
  for (const step of plan1.steps) {
    console.log(`     - [${step.id}] ${step.protocol}.${step.action}: ${step.description}`);
  }

  // 演示 2: 两步跨协议
  console.log('\n   ▶ 演示 2: 解析 "在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC"');
  const plan2 = await orchestrator.parseIntent('在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC');
  console.log(`     步骤数: ${plan2.steps.length}`);
  console.log(`     描述: ${plan2.summary}`);
  for (const step of plan2.steps) {
    console.log(`     - [${step.id}] ${step.protocol}.${step.action}: ${step.description}`);
    if (step.dependsOn && step.dependsOn.length > 0) {
      console.log(`       依赖: ${step.dependsOn.join(', ')}`);
    }
  }

  // 演示 3: 完整三步流程
  console.log('\n   ▶ 演示 3: 解析 "在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC，最后将收益转入地址"');
  const plan3 = await orchestrator.parseIntent(
    '在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC，最后将收益转入 0x1234567890abcdef1234567890abcdef12345678'
  );
  console.log(`     步骤数: ${plan3.steps.length}`);
  console.log(`     描述: ${plan3.summary}`);
  for (const step of plan3.steps) {
    console.log(`     - [${step.id}] ${step.protocol}.${step.action}: ${step.description}`);
    if (step.dependsOn && step.dependsOn.length > 0) {
      console.log(`       依赖: ${step.dependsOn.join(', ')}`);
    }
  }

  // 演示 4: 执行计划
  console.log('\n   ▶ 演示 4: 执行两步跨协议计划');
  const result = await orchestrator.executePlan(plan2, '0xsigner1234567890abcdef1234567890abcdef12345678');
  console.log(`     执行结果: ${result.success ? '✅ 成功' : '❌ 失败'}`);
  for (const sr of result.stepResults) {
    console.log(`     - [${sr.stepId}] ${sr.protocol}.${sr.action}: ${sr.success ? '✅' : '❌'} ${sr.error || ''}`);
  }

  console.log(`\n   ✅ 跨协议意图解析演示完成`);
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log('\n');
  console.log('='.repeat(70));
  console.log('  Sui 测试网真实交易演示');
  console.log('='.repeat(70));
  console.log(`  RPC: ${SUI_TESTNET_RPC}`);
  console.log(`  浏览器: ${EXPLORER_URL}`);
  console.log('='.repeat(70));

  // 获取签名者
  const signer = getSigner();
  const hasPrivateKey = !!process.env.SUI_PRIVATE_KEY;

  if (hasPrivateKey) {
    const sender = signer.toSuiAddress();
    console.log(`\n🔑 签名者地址: ${sender}`);
    console.log(`   查看地址: https://testnet.suivision.xyz/address/${sender}`);

    // 创建客户端
    const client = createClient();

    // 场景 1: 查询余额
    const balance = await demoCheckBalance(client, sender);

    if (balance > 0n) {
      // 场景 2: 构建并模拟交易
      await demoBuildTransferTx(client, sender);

      // 场景 3: 发送真实交易
      const txDigest = await demoSendTransferTx(client, signer, sender);

      if (txDigest) {
        console.log(`\n🔗 可在浏览器查看交易:`);
        console.log(`   ${EXPLORER_URL}/${txDigest}`);
      }
    } else {
      console.log(`\n⚠️  账户余额为 0，无法发送交易`);
      console.log(`   请从水龙头获取测试币:`);
      console.log(`   - https://faucet.sui.io/`);
      console.log(`   - 或使用 CLI: sui client faucet`);
    }
  } else {
    console.log(`\n🔑 未提供私钥，将以只读模式演示`);
    console.log(`   如需发送真实交易，请设置环境变量:`);
    console.log(`   export SUI_PRIVATE_KEY=<private_key>`);
    console.log(`\n   支持的私钥格式:`);
    console.log(`   1. Bech32: suiprivkey1qxxx... (Sui CLI 导出格式)`);
    console.log(`   2. Hex:    64 位十六进制字符串`);
    console.log(`   3. Base64: 原始 32 字节私钥的 Base64 编码`);
    console.log(`\n   生成私钥: sui keytool generate`);
    console.log(`   导出私钥: sui keytool export --key-identity <address>`);
  }

  // 场景 4: 跨协议意图解析（不需要私钥）
  await demoCrossProtocolIntent();

  // 汇总
  console.log('\n');
  console.log('='.repeat(70));
  console.log('  演示完成');
  console.log('='.repeat(70));

  if (hasPrivateKey) {
    console.log('\n📌 测试网交易查看方式:');
    console.log(`   1. SuiVision: https://testnet.suivision.xyz/`);
    console.log(`   2. SuiScan:   https://testnet.suiscan.xyz/`);
    console.log(`   3. 输入交易摘要即可查看详情`);
  }

  console.log('\n📌 跨协议意图功能已就绪，可通过以下方式使用:');
  console.log(`   1. 单元测试: npx jest --config jest.config.cjs --testPathPattern="sui/__tests__"`);
  console.log(`   2. 验收测试: npx tsx src/sui/__tests__/acceptance-test.ts`);
  console.log(`   3. 本演示:   SUI_PRIVATE_KEY=<key> npx tsx src/sui/__tests__/testnet-demo.ts`);
  console.log();
}

main().catch(console.error);
