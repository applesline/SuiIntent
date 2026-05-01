/**
 * Sui DeFi 模块集成测试
 *
 * 测试跨协议复杂意图流程的端到端功能。
 * 验证编排器、适配器和 MCP Server 的协作。
 */

import { CrossProtocolOrchestrator } from '../cross-protocol-orchestrator.js';
import { SuiMCPServer } from '../mcp-server.js';

describe('Sui DeFi 集成测试', () => {
  const testConfig = {
    network: 'testnet' as const,
    contractAddresses: {
      cetus_package: '0xcetus_package',
      cetus_global_config: '0xglobal_config',
      navi_package: '0xnavi_package',
      navi_storage: '0xstorage',
      navi_price_oracle: '0xoracle',
    },
  };

  const testSigner = '0xsigner1234567890abcdef1234567890abcdef12345678';

  describe('场景 1: Cetus Swap + Navi Deposit', () => {
    it('应该能解析并执行 "在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC"', async () => {
      const orchestrator = new CrossProtocolOrchestrator(testConfig);
      await orchestrator.initialize();

      // 解析意图
      const plan = await orchestrator.parseIntent(
        '在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC',
      );

      expect(plan.steps.length).toBeGreaterThanOrEqual(2);
      expect(plan.steps[0].protocol).toBe('cetus');
      expect(plan.steps[0].action).toBe('swap');
      expect(plan.steps[1].protocol).toBe('navi');

      // 执行计划
      const result = await orchestrator.executePlan(plan, testSigner);

      expect(result.success).toBe(true);
      expect(result.stepResults.length).toBeGreaterThanOrEqual(2);
      expect(result.stepResults.every(s => s.success)).toBe(true);
    });
  });

  describe('场景 2: Cetus Swap + Transfer', () => {
    it('应该能解析并执行 "在 Cetus 上卖出 SUI 买入 USDC，然后将收益转入某地址"', async () => {
      const orchestrator = new CrossProtocolOrchestrator(testConfig);
      await orchestrator.initialize();

      const plan = await orchestrator.parseIntent(
        '在 Cetus 上卖出 SUI 买入 USDC，然后将收益转入 0x1234567890abcdef1234567890abcdef12345678',
      );

      expect(plan.steps.length).toBeGreaterThanOrEqual(2);
      expect(plan.steps[0].protocol).toBe('cetus');
      expect(plan.steps[plan.steps.length - 1].protocol).toBe('sui');
      expect(plan.steps[plan.steps.length - 1].action).toBe('transfer');

      const result = await orchestrator.executePlan(plan, testSigner);

      expect(result.success).toBe(true);
    });
  });

  describe('场景 3: 完整的三步流程', () => {
    it('应该能解析并执行 "在 Cetus 上卖出 A，同时在 Navi 上买入 B，最后将收益转入某地址"', async () => {
      const orchestrator = new CrossProtocolOrchestrator(testConfig);
      await orchestrator.initialize();

      const plan = await orchestrator.parseIntent(
        '在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC，最后将收益转入 0x1234567890abcdef1234567890abcdef12345678',
      );

      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
      expect(plan.steps[0].protocol).toBe('cetus');
      expect(plan.steps[1].protocol).toBe('navi');
      expect(plan.steps[plan.steps.length - 1].protocol).toBe('sui');

      const result = await orchestrator.executePlan(plan, testSigner);

      expect(result.success).toBe(true);
      expect(result.stepResults.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('场景 4: MCP Server 集成', () => {
    it('应该能通过 MCP Server 解析和执行意图', async () => {
      const server = new SuiMCPServer(testConfig);
      await server.initialize();

      // 获取工具定义
      const tools = server.getTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some(t => t.name === 'sui_parse_intent')).toBe(true);
      expect(tools.some(t => t.name === 'sui_execute_intent')).toBe(true);

      // 获取工具处理函数
      const handlers = server.getToolHandlers();
      expect(handlers.sui_parse_intent).toBeDefined();
      expect(handlers.sui_execute_intent).toBeDefined();

      // 解析意图
      const plan = await handlers.sui_parse_intent({
        intent: '在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC',
      });

      expect(plan.steps.length).toBeGreaterThanOrEqual(2);

      // 执行意图
      const result = await handlers.sui_execute_intent({
        intent: '在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC',
        signerAddress: testSigner,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('场景 5: 错误处理', () => {
    it('应该能处理无效意图', async () => {
      const orchestrator = new CrossProtocolOrchestrator(testConfig);
      await orchestrator.initialize();

      await expect(
        orchestrator.parseIntent(''),
      ).rejects.toThrow();
    });

    it('应该能处理未初始化的编排器', async () => {
      const orchestrator = new CrossProtocolOrchestrator(testConfig);

      await expect(
        orchestrator.executePlan(
          {
            id: 'test',
            query: 'test',
            steps: [],
            canMergeToPTB: false,
            summary: 'test',
          },
          testSigner,
        ),
      ).rejects.toThrow('not initialized');
    });
  });
});
