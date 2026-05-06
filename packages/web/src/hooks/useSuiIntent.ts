/**
 * useSuiIntent Hook
 *
 * 将 Intentorch 的编排能力与 Sui 的 PTB 能力合二为一。
 * 前端调用 daemon API 传递 apiKey，daemon 用完即弃。
 *
 * 流程：
 * 1. 用户输入自然语言意图
 * 2. 前端调用 daemon API /api/sui/parse-intent（传递 apiKey）
 * 3. daemon 使用 CloudIntentEngine + Sui MCP Tools 解析意图
 * 4. 前端展示 LLM 解析的结构化计划
 * 5. 用户确认后，调用 daemon API /api/sui/build-transaction 构建真实 PTB
 * 6. 通过钱包签名执行 PTB
 *
 * PTB 构建逻辑（由 daemon 端的 CrossProtocolOrchestrator 完成）：
 * - cetus_swap: 通过 CetusAdapter.addCommands 调用 Cetus DEX 合约
 * - navi_deposit/withdraw/borrow/repay: 通过 NaviAdapter.addCommands 调用 Navi Protocol 合约
 * - sui_transfer: 通过 SuiAdapter.addCommands 使用 Transaction.transferObjects 转账
 *
 * 使用方式：
 *   const { parseSuiIntent, executeSuiPlan, isParsing, isExecuting, plan, result } = useSuiIntent();
 *   await parseSuiIntent("在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC");
 *   await executeSuiPlan();
 */

import { useState, useCallback, useEffect, useContext } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient, SuiClientContext } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import { useLanguage } from '../contexts/LanguageContext';

// ===== 类型定义 =====

export interface CrossProtocolStep {
  id: string;
  toolName: string;
  description: string;
  arguments: Record<string, any>;
  dependsOn: string[];
}

export interface CrossProtocolPlan {
  id: string;
  summary: string;
  steps: CrossProtocolStep[];
}

export interface SuiIntentStepResult {
  stepId: string;
  toolName: string;
  success: boolean;
  error?: string;
  txDigest?: string;
}

export interface SuiIntentResult {
  success: boolean;
  plan?: CrossProtocolPlan;
  stepResults: SuiIntentStepResult[];
  txDigest?: string;
  error?: string;
  isDryRun?: boolean;
}

// ===== AI 配置类型 =====

export interface AIConfig {
  provider: string;
  apiKey: string;
  model: string;
}

const DAEMON_BASE_URL = 'http://localhost:9658';

// ===== AI 配置管理 =====

const AI_CONFIG_KEY = 'sui_intent_ai_config';

export function getAIConfig(): AIConfig | null {
  try {
    const stored = localStorage.getItem(AI_CONFIG_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {}
  return null;
}

export function saveAIConfig(config: AIConfig): void {
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
}

export function clearAIConfig(): void {
  localStorage.removeItem(AI_CONFIG_KEY);
}

// ===== Hook =====

export function useSuiIntent() {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const { language } = useLanguage();

  const [isParsing, setIsParsing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [plan, setPlan] = useState<CrossProtocolPlan | null>(null);
  const [result, setResult] = useState<SuiIntentResult | null>(null);
  const [network, setNetwork] = useState<'mainnet' | 'testnet'>('testnet');

  // 自动检测网络：从 SuiClientContext 中获取当前选中的网络
  const suiClientContext = useContext(SuiClientContext);
  useEffect(() => {
    if (suiClientContext?.network) {
      const ctxNetwork = suiClientContext.network;
      if (ctxNetwork === 'mainnet' || ctxNetwork === 'testnet') {
        setNetwork(ctxNetwork);
      }
    }
  }, [suiClientContext?.network]);

  /**
   * 解析 Sui 自然语言意图
   * 调用 daemon API /api/sui/parse-intent，传递 apiKey
   */
  const parseSuiIntent = useCallback(async (intent: string): Promise<CrossProtocolPlan | null> => {
    if (!intent.trim()) return null;

    setIsParsing(true);
    setResult(null);

    try {
      // 获取 AI 配置
      const aiConfig = getAIConfig();
      if (!aiConfig || !aiConfig.apiKey) {
        setResult({
          success: false,
          stepResults: [],
          error: '请先配置 AI 提供商和 API Key（点击右上角 ⚙️ 按钮）',
        });
        return null;
      }

      // 调用 daemon API（传递当前语言设置和网络环境，让 LLM system prompt 使用对应语言和网络）
      const response = await fetch(`${DAEMON_BASE_URL}/api/sui/parse-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent,
          apiKey: aiConfig.apiKey,
          provider: aiConfig.provider,
          model: aiConfig.model,
          language,
          network,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API 请求失败 (${response.status})`);
      }

      const data = await response.json();

      if (!data.success || !data.plan) {
        throw new Error(data.error || '意图解析失败');
      }

      const parsedPlan: CrossProtocolPlan = {
        id: data.plan.id,
        summary: data.plan.summary,
        steps: data.plan.steps.map((step: any) => ({
          id: step.id,
          toolName: step.toolName,
          description: step.description,
          arguments: step.arguments,
          dependsOn: step.dependsOn || [],
        })),
      };

      setPlan(parsedPlan);
      return parsedPlan;
    } catch (error: any) {
      setResult({
        success: false,
        stepResults: [],
        error: `意图解析失败: ${error.message}`,
      });
      return null;
    } finally {
      setIsParsing(false);
    }
  }, []);

  /**
   * 调用 daemon API 构建 PTB 交易
   * @param targetPlan - 要构建的计划（从外部传入，避免 React 状态异步更新问题）
   */
  const buildTransactionViaDaemon = useCallback(async (targetPlan?: CrossProtocolPlan): Promise<{ txBytes: Uint8Array; tx: Transaction }> => {
    const effectivePlan = targetPlan || plan;
    if (!effectivePlan) throw new Error('请先解析意图');

    // 调用 daemon API /api/sui/build-transaction 构建真实 PTB
    const response = await fetch(`${DAEMON_BASE_URL}/api/sui/build-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: {
          id: effectivePlan.id,
          summary: effectivePlan.summary,
          steps: effectivePlan.steps,
        },
        signerAddress: currentAccount?.address || '',
        network,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `构建交易失败 (${response.status})`);
    }

    const data = await response.json();
    if (!data.success || !data.txBytes) {
      throw new Error(data.error || '构建交易失败');
    }

    // 将 base64 的 txBytes 解码为 Uint8Array
    const txBytes = fromBase64(data.txBytes);

    // 从 txBytes 重建 Transaction 对象
    // daemon 使用 onlyTransactionKind=true 构建，返回的是 TransactionKind 字节（不是完整的 TransactionData）。
    // 必须使用 Transaction.fromKind() 来反序列化，因为 Transaction.from() 期望的是完整的 TransactionData，
    // 会把 TransactionKind 的枚举值 10（ProgrammableTransaction）当作 TransactionData 的 V1 枚举值来解析，
    // 导致 "Unknown value 10 for enum TransactionKind" 错误。
    const tx = Transaction.fromKind(txBytes);

    // 关键修复：必须设置 sender，否则钱包在解析 gas payment 时会失败（报 Transaction gas payment missing）
    if (currentAccount?.address) {
      tx.setSender(currentAccount.address);
    }

    return { txBytes, tx };
  }, [plan, currentAccount, network]);

  /**
   * 模拟执行（Dry Run）- 通过 daemon API 构建真实 PTB 但不签名发送
   * @param targetPlan - 要模拟执行的计划（从外部传入，避免 React 状态异步更新问题）
   */
  const dryRunPlan = useCallback(async (targetPlan?: CrossProtocolPlan): Promise<SuiIntentResult> => {
    const effectivePlan = targetPlan || plan;
    if (!effectivePlan || !currentAccount) {
      return {
        success: false,
        stepResults: [],
        error: !effectivePlan ? '请先解析意图' : '请先连接钱包',
      };
    }

    setIsExecuting(true);

    try {
      // 通过 daemon API 构建真实 PTB（传入 effectivePlan，避免 React 状态异步更新问题）
      const { tx } = await buildTransactionViaDaemon(effectivePlan);

      // 构建完整的 TransactionData 字节，因为 dryRunTransactionBlock 不接受 TransactionKind
      const fullTxBytes = await tx.build({ client: suiClient });

      // 使用 suiClient 进行 dryRun
      const dryRunResult = await suiClient.dryRunTransactionBlock({
        transactionBlock: fullTxBytes,
      });

      const status = dryRunResult.effects.status.status;
      const stepResults: SuiIntentStepResult[] = effectivePlan.steps.map((step) => ({
        stepId: step.id,
        toolName: step.toolName,
        success: status === 'success',
        txDigest: 'dry-run',
      }));

      const suiResult: SuiIntentResult = {
        success: status === 'success',
        plan: effectivePlan,
        stepResults,
        isDryRun: true,
        error: status !== 'success' ? dryRunResult.effects.status.error : undefined,
      };

      setResult(suiResult);
      return suiResult;
    } catch (error: any) {
      const suiResult: SuiIntentResult = {
        success: false,
        plan: effectivePlan,
        stepResults: [],
        error: `模拟执行失败: ${error.message}`,
        isDryRun: true,
      };
      setResult(suiResult);
      return suiResult;
    } finally {
      setIsExecuting(false);
    }
  }, [plan, currentAccount, suiClient, buildTransactionViaDaemon]);

  /**
   * 执行 Sui 计划 - 通过 daemon API 构建真实 PTB，通过钱包签名并发送
   *
   * 注意：使用 Transaction 对象（从 txBytes 反序列化）传给钱包签名，
   * 而不是 tx.toJSON() 的 JSON 字符串。因为 toJSON() 返回的 JSON 中
   * 包含 digest 字段，而 TransactionDataBuilder.restore() 使用的
   * TransactionDataSchema 不包含 digest 字段，会导致 valibot parse 错误。
   * 使用 Transaction 对象时，useSignAndExecuteTransaction 会调用
   * transaction.toJSON({ supportedIntents, client })，使用前端配置的
   * SuiClient 来构建交易，不会出现 digest 字段的问题。
   */
  const executeSuiPlan = useCallback(async (): Promise<SuiIntentResult> => {
    if (!plan || !currentAccount) {
      return {
        success: false,
        stepResults: [],
        error: !plan ? '请先解析意图' : '请先连接钱包',
      };
    }

    setIsExecuting(true);

    try {
      // 通过 daemon API 构建真实 PTB（使用 CrossProtocolOrchestrator）
      const { tx } = await buildTransactionViaDaemon();

      // 通过钱包签名并执行（根据当前网络动态设置 chain）
      // 使用 Transaction 对象而不是 JSON 字符串，
      // 避免 toJSON() 返回的 JSON 中包含 digest 字段导致 valibot parse 错误
      const txResult = await signAndExecuteTransaction({
        transaction: tx,
        chain: network === 'mainnet' ? 'sui:mainnet' : 'sui:testnet',
      });

      const digest = txResult.digest;
      const stepResults: SuiIntentStepResult[] = plan.steps.map((step) => ({
        stepId: step.id,
        toolName: step.toolName,
        success: true,
        txDigest: digest,
      }));

      const suiResult: SuiIntentResult = {
        success: true,
        plan,
        stepResults,
        txDigest: digest,
      };

      setResult(suiResult);
      return suiResult;
    } catch (error: any) {
      const stepResults: SuiIntentStepResult[] = plan.steps.map((step) => ({
        stepId: step.id,
        toolName: step.toolName,
        success: false,
        error: error.message,
      }));

      const suiResult: SuiIntentResult = {
        success: false,
        plan,
        stepResults,
        error: `执行失败: ${error.message}`,
      };

      setResult(suiResult);
      return suiResult;
    } finally {
      setIsExecuting(false);
    }
  }, [plan, currentAccount, signAndExecuteTransaction, buildTransactionViaDaemon]);

  /**
   * 重置状态
   */
  const reset = useCallback(() => {
    setPlan(null);
    setResult(null);
    setIsParsing(false);
    setIsExecuting(false);
  }, []);

  return {
    // 状态
    isParsing,
    isExecuting,
    plan,
    result,
    isWalletConnected: !!currentAccount,
    walletAddress: currentAccount?.address,
    network,
    setNetwork,

    // 方法
    parseSuiIntent,
    dryRunPlan,
    executeSuiPlan,
    reset,
  };
}
