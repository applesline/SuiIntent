/**
 * Sui DeFi 模块入口
 *
 * 提供基于 Sui 区块链的跨协议 DeFi 操作能力。
 * 支持 Cetus DEX、Navi Protocol 等主流协议。
 *
 * @module sui
 */

// 类型定义
export type {
  DeFiProtocol,
  SwapQuote,
  CrossProtocolStep,
  CrossProtocolPlan,
  CrossProtocolResult,
  CrossProtocolStepResult,
} from './types.js';

// 适配器类型
export type { IProtocolAdapter, AdapterConfig } from './adapters/types.js';

// Cetus 适配器
export { CetusAdapter } from './adapters/cetus-adapter.js';
export type { CetusPoolInfo } from './adapters/cetus-adapter.js';

// Navi 适配器
export { NaviAdapter } from './adapters/navi-adapter.js';

// Sui 原生适配器
export { SuiAdapter } from './adapters/sui-adapter.js';

// 跨协议编排器
export { CrossProtocolOrchestrator, getOrchestrator } from './cross-protocol-orchestrator.js';
export type { OrchestratorConfig } from './cross-protocol-orchestrator.js';

// MCP Server
export { SuiMCPServer } from './mcp-server.js';
export type { MCPToolDefinition, MCPToolHandlers } from './mcp-server.js';

// Sui MCP Tools（供 CloudIntentEngine 注册使用）
export { getSuiMCPTools } from './sui-mcp-tools.js';

// 网络配置
export { getCetusConfig, getNaviConfig, getRpcUrl } from './network-config.js';
export type { SuiNetwork, CetusContractConfig, NaviContractConfig, NetworkContracts } from './network-config.js';
