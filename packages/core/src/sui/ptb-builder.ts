/**
 * Sui PTB (Programmable Transaction Block) Builder
 *
 * 将多个跨协议步骤合并为单个 PTB，利用 Sui 的原子性保证：
 * - 所有操作要么全部成功，要么全部失败
 * - 一次签名，一次 Gas 费
 * - 减少用户交互次数
 *
 * 重构后：适配器直接使用 @mysten/sui 的 Transaction 对象，
 * 此 Builder 作为辅助工具，提供步骤合并分析和 Gas 估算。
 */

import { Transaction } from '@mysten/sui/transactions';
import { logger } from '../core/logger.js';
import type { CrossProtocolStep } from './types.js';

/** PTB 构建结果 */
export interface PTBBuildResult {
  canMerge: boolean;
  reason?: string;
  estimatedGas?: string;
}

/**
 * Sui PTB Builder
 *
 * 核心能力：
 * 1. 分析步骤是否可以合并为单个 PTB
 * 2. 估算 Gas 费用
 */
export class SuiPTBBuilder {
  /**
   * 分析步骤是否可以合并为单个 PTB
   *
   * 合并条件：
   * 1. 所有步骤都在 Sui 链上执行
   * 2. 步骤间没有外部依赖（如需要等待链下事件）
   * 3. 步骤数不超过 PTB 限制（目前 Sui PTB 最多 1024 个命令）
   * 4. 所有步骤的输入参数都可以在构建时确定
   */
  canMerge(steps: CrossProtocolStep[]): PTBBuildResult {
    if (steps.length === 0) {
      return { canMerge: false, reason: 'No steps to merge' };
    }

    // 检查步骤数限制
    const MAX_PTB_COMMANDS = 1024;
    if (steps.length > MAX_PTB_COMMANDS) {
      return {
        canMerge: false,
        reason: `Too many steps (${steps.length}), PTB limit is ${MAX_PTB_COMMANDS}`,
      };
    }

    // 检查是否有链下依赖
    for (const step of steps) {
      if (this.hasOffChainDependency(step)) {
        return {
          canMerge: false,
          reason: `Step "${step.id}" (${step.action}) has off-chain dependencies that cannot be resolved in PTB`,
        };
      }
    }

    // 检查依赖图是否可以在 PTB 内表达
    const dependencyCheck = this.validateDependencyGraph(steps);
    if (!dependencyCheck.valid) {
      return {
        canMerge: false,
        reason: dependencyCheck.reason,
      };
    }

    // 可以合并
    return {
      canMerge: true,
      estimatedGas: this.estimateGas(steps),
    };
  }

  /**
   * 估算 Gas 费用
   *
   * 基于步骤数量和复杂度进行估算
   */
  estimateGas(steps: CrossProtocolStep[]): string {
    const BASE_GAS = 500_000; // 基础 Gas
    const PER_STEP_GAS = 200_000; // 每步额外 Gas

    const totalGas = BASE_GAS + steps.length * PER_STEP_GAS;
    return totalGas.toString();
  }

  /**
   * 检查步骤是否有链下依赖
   */
  private hasOffChainDependency(step: CrossProtocolStep): boolean {
    // 检查参数中是否有需要链下查询的动态值
    const paramsStr = JSON.stringify(step.params);

    // 如果参数包含需要实时查询的标记，则不能合并
    const offChainPatterns = [
      '{{price_impact}}',
      '{{estimated_gas}}',
      '{{current_price}}',
    ];

    return offChainPatterns.some((pattern) => paramsStr.includes(pattern));
  }

  /**
   * 验证依赖图是否可以在 PTB 内表达
   */
  private validateDependencyGraph(
    steps: CrossProtocolStep[],
  ): { valid: boolean; reason?: string } {
    const stepMap = new Map(steps.map((s) => [s.id, s]));

    for (const step of steps) {
      for (const depId of step.dependsOn) {
        if (!stepMap.has(depId)) {
          return {
            valid: false,
            reason: `Step "${step.id}" depends on non-existent step "${depId}"`,
          };
        }
      }
    }

    // 检查循环依赖
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (inStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      inStack.add(nodeId);

      const step = stepMap.get(nodeId);
      if (step) {
        for (const depId of step.dependsOn) {
          if (hasCycle(depId)) return true;
        }
      }

      inStack.delete(nodeId);
      return false;
    };

    for (const step of steps) {
      if (hasCycle(step.id)) {
        return {
          valid: false,
          reason: `Circular dependency detected involving step "${step.id}"`,
        };
      }
    }

    return { valid: true };
  }
}

/** 单例 */
let ptbBuilderInstance: SuiPTBBuilder | null = null;

export function getPTBBuilder(): SuiPTBBuilder {
  if (!ptbBuilderInstance) {
    ptbBuilderInstance = new SuiPTBBuilder();
  }
  return ptbBuilderInstance;
}
