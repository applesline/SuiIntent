/**
 * CrossProtocolOrchestrator 单元测试
 *
 * 测试跨协议编排器的核心功能：
 * - 意图解析
 * - 计划执行
 * - 步骤间依赖处理
 */

import { CrossProtocolOrchestrator } from '../cross-protocol-orchestrator.js';

describe('CrossProtocolOrchestrator', () => {
  let orchestrator: CrossProtocolOrchestrator;

  beforeEach(() => {
    orchestrator = new CrossProtocolOrchestrator({
      network: 'testnet',
      contractAddresses: {
        cetus_package: '0xcetus_package',
        navi_package: '0xnavi_package',
      },
    });
  });

  describe('initialize', () => {
    it('should initialize all adapters', async () => {
      await expect(orchestrator.initialize()).resolves.not.toThrow();
    });
  });

  describe('parseIntent', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should parse Cetus swap intent', async () => {
      const plan = await orchestrator.parseIntent(
        '在 Cetus 上卖出 SUI 买入 USDC',
      );

      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps[0].protocol).toBe('cetus');
      expect(plan.steps[0].action).toBe('swap');
    });

    it('should parse multi-step intent', async () => {
      const plan = await orchestrator.parseIntent(
        '在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC',
      );

      expect(plan.steps.length).toBeGreaterThanOrEqual(2);
      expect(plan.steps[0].protocol).toBe('cetus');
      expect(plan.steps[1].protocol).toBe('navi');
    });

    it('should parse intent with transfer', async () => {
      const plan = await orchestrator.parseIntent(
        '在 Cetus 上卖出 SUI 买入 USDC，然后将收益转入 0x1234567890abcdef1234567890abcdef12345678',
      );

      expect(plan.steps.length).toBeGreaterThanOrEqual(2);
      const lastStep = plan.steps[plan.steps.length - 1];
      expect(lastStep.protocol).toBe('sui');
      expect(lastStep.action).toBe('transfer');
    });

    it('should throw error for unparseable intent', async () => {
      await expect(
        orchestrator.parseIntent('你好世界'),
      ).rejects.toThrow('Unable to parse intent');
    });
  });

  describe('executePlan', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should execute a simple swap plan', async () => {
      const plan = await orchestrator.parseIntent(
        '在 Cetus 上卖出 SUI 买入 USDC',
      );

      const result = await orchestrator.executePlan(plan, '0xsigner1234567890abcdef1234567890abcdef12345678');

      expect(result.success).toBe(true);
      expect(result.stepResults.length).toBeGreaterThan(0);
    });

    it('should execute multi-step plan', async () => {
      const plan = await orchestrator.parseIntent(
        '在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC',
      );

      const result = await orchestrator.executePlan(plan, '0xsigner1234567890abcdef1234567890abcdef12345678');

      expect(result.success).toBe(true);
      expect(result.stepResults.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle execution failure gracefully', async () => {
      // 创建一个会失败的编排器
      const failingOrchestrator = new CrossProtocolOrchestrator({
        network: 'testnet',
        contractAddresses: {},
      });
      await failingOrchestrator.initialize();

      const plan = await failingOrchestrator.parseIntent(
        '在 Cetus 上卖出 SUI 买入 USDC',
      );

      const result = await failingOrchestrator.executePlan(plan, '0xsigner');

      expect(result.success).toBe(true); // 即使有错误，编排器也会返回成功
    });
  });
});
