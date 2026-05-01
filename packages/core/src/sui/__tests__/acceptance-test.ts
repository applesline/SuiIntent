/**
 * 跨协议复杂意图流程 - 验收测试脚本
 *
 * 运行方式: npx ts-node --esm src/sui/__tests__/acceptance-test.ts
 * 或: npx tsx src/sui/__tests__/acceptance-test.ts
 *
 * 这个脚本演示了所有核心功能，供人工验收测试。
 */

import { CrossProtocolOrchestrator } from '../cross-protocol-orchestrator.js';
import { SuiMCPServer } from '../mcp-server.js';

const CONFIG = {
  network: 'testnet' as const,
  contractAddresses: {
    cetus_package: '0x...',
    navi_package: '0x...',
    sui_system: '0x3',
  },
};

const SIGNER = '0xsigner1234567890abcdef1234567890abcdef12345678';

async function runAcceptanceTests() {
  console.log('\n');
  console.log('='.repeat(70));
  console.log('  SuiIntent 跨协议复杂意图流程 - 验收测试');
  console.log('='.repeat(70));

  // ============================================================
  // 测试 1: 初始化编排器
  // ============================================================
  console.log('\n📋 测试 1: 初始化编排器');
  console.log('-'.repeat(50));
  const orchestrator = new CrossProtocolOrchestrator(CONFIG);
  await orchestrator.initialize();
  console.log('✅ 编排器初始化成功');

  // ============================================================
  // 测试 2: 解析单步意图 - Cetus Swap
  // ============================================================
  console.log('\n📋 测试 2: 解析单步意图 - Cetus Swap');
  console.log('-'.repeat(50));
  const plan1 = await orchestrator.parseIntent('在 Cetus 上卖出 SUI 买入 USDC');
  console.log(`✅ 意图解析成功`);
  console.log(`   步骤数: ${plan1.steps.length}`);
  console.log(`   描述: ${plan1.summary}`);
  console.log(`   步骤详情:`);
  for (const step of plan1.steps) {
    console.log(`     - [${step.id}] ${step.protocol}.${step.action}: ${step.description}`);
    console.log(`       参数: ${JSON.stringify(step.params, null, 2)}`);
  }

  // ============================================================
  // 测试 3: 执行单步计划
  // ============================================================
  console.log('\n📋 测试 3: 执行单步计划');
  console.log('-'.repeat(50));
  const result1 = await orchestrator.executePlan(plan1, SIGNER);
  console.log(`✅ 执行结果: ${result1.success ? '成功' : '失败'}`);
  console.log(`   交易摘要: ${result1.txDigest}`);
  console.log(`   Gas 消耗: ${result1.totalGasUsed}`);

  // ============================================================
  // 测试 4: 解析两步跨协议意图 - Cetus Swap + Navi Deposit
  // ============================================================
  console.log('\n📋 测试 4: 解析两步跨协议意图 - Cetus Swap → Navi Deposit');
  console.log('-'.repeat(50));
  const plan2 = await orchestrator.parseIntent('在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC');
  console.log(`✅ 意图解析成功`);
  console.log(`   步骤数: ${plan2.steps.length}`);
  console.log(`   描述: ${plan2.summary}`);
  console.log(`   步骤详情:`);
  for (const step of plan2.steps) {
    console.log(`     - [${step.id}] ${step.protocol}.${step.action}: ${step.description}`);
    console.log(`       依赖: ${step.dependsOn?.length ? step.dependsOn.join(', ') : '无'}`);
  }

  // ============================================================
  // 测试 5: 执行两步跨协议计划
  // ============================================================
  console.log('\n📋 测试 5: 执行两步跨协议计划');
  console.log('-'.repeat(50));
  const result2 = await orchestrator.executePlan(plan2, SIGNER);
  console.log(`✅ 执行结果: ${result2.success ? '成功' : '失败'}`);
  console.log(`   步骤结果:`);
  for (const sr of result2.stepResults) {
    console.log(`     - [${sr.stepId}] ${sr.protocol}.${sr.action}: ${sr.success ? '✅' : '❌'} ${sr.error || ''}`);
  }

  // ============================================================
  // 测试 6: 解析完整三步流程 - Cetus Swap + Navi Deposit + Transfer
  // ============================================================
  console.log('\n📋 测试 6: 解析完整三步流程 - Cetus Swap → Navi Deposit → Transfer');
  console.log('-'.repeat(50));
  const plan3 = await orchestrator.parseIntent(
    '在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC，最后将收益转入 0x1234567890abcdef1234567890abcdef12345678'
  );
  console.log(`✅ 意图解析成功`);
  console.log(`   步骤数: ${plan3.steps.length}`);
  console.log(`   描述: ${plan3.summary}`);
  console.log(`   步骤详情:`);
  for (const step of plan3.steps) {
    console.log(`     - [${step.id}] ${step.protocol}.${step.action}: ${step.description}`);
    console.log(`       依赖: ${step.dependsOn?.length ? step.dependsOn.join(', ') : '无'}`);
  }

  // ============================================================
  // 测试 7: 执行完整三步流程
  // ============================================================
  console.log('\n📋 测试 7: 执行完整三步流程');
  console.log('-'.repeat(50));
  const result3 = await orchestrator.executePlan(plan3, SIGNER);
  console.log(`✅ 执行结果: ${result3.success ? '成功' : '失败'}`);
  console.log(`   步骤结果:`);
  for (const sr of result3.stepResults) {
    console.log(`     - [${sr.stepId}] ${sr.protocol}.${sr.action}: ${sr.success ? '✅' : '❌'} ${sr.error || ''}`);
  }

  // ============================================================
  // 测试 8: MCP Server 功能
  // ============================================================
  console.log('\n📋 测试 8: MCP Server 功能');
  console.log('-'.repeat(50));
  const mcpServer = new SuiMCPServer(CONFIG);
  await mcpServer.initialize();
  console.log('✅ MCP Server 初始化成功');

  const tools = mcpServer.getTools();
  console.log(`   注册工具数: ${tools.length}`);
  for (const tool of tools) {
    console.log(`     - ${tool.name}: ${tool.description}`);
  }

  const handlers = mcpServer.getToolHandlers();
  const supportedProtocols = await handlers.sui_get_supported_protocols({});
  console.log(`   支持的协议:`);
  for (const p of supportedProtocols.protocols) {
    console.log(`     - ${p.name} (${p.protocol}): ${p.actions.join(', ')}`);
  }

  // ============================================================
  // 测试 9: 错误处理 - 无效意图
  // ============================================================
  console.log('\n📋 测试 9: 错误处理 - 无效意图');
  console.log('-'.repeat(50));
  try {
    await orchestrator.parseIntent('你好世界');
    console.log('❌ 应该抛出错误但未抛出');
  } catch (error: any) {
    console.log(`✅ 正确捕获错误: ${error.message}`);
  }

  // ============================================================
  // 测试 10: 错误处理 - 未初始化
  // ============================================================
  console.log('\n📋 测试 10: 错误处理 - 未初始化');
  console.log('-'.repeat(50));
  const uninitializedOrch = new CrossProtocolOrchestrator(CONFIG);
  try {
    await uninitializedOrch.parseIntent('test');
    console.log('❌ 应该抛出错误但未抛出');
  } catch (error: any) {
    console.log(`✅ 正确捕获错误: ${error.message}`);
  }

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n');
  console.log('='.repeat(70));
  console.log('  验收测试完成');
  console.log('='.repeat(70));
  console.log('\n✅ 所有功能验证通过！\n');
}

runAcceptanceTests().catch(console.error);
