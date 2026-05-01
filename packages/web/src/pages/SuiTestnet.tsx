import React, { useState, useCallback } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { CrossProtocolOrchestrator } from '@intentorch/core/sui/cross-protocol-orchestrator';
import { Loader2, Sparkles, AlertCircle, CheckCircle, ArrowRight, Wallet, ExternalLink } from 'lucide-react';

interface StepResult {
  stepId: string;
  protocol: string;
  action: string;
  success: boolean;
  error?: string;
  txDigest?: string;
}

const TESTNET_RPC = 'https://fullnode.testnet.sui.io:443';
const EXPLORER_URL = 'https://testnet.suivision.xyz';

const SuiTestnet: React.FC = () => {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();

  const [intent, setIntent] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [txDigest, setTxDigest] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'parsed' | 'executing' | 'success' | 'error'>('idle');

  const handleParseIntent = useCallback(async () => {
    if (!intent.trim()) return;

    setIsParsing(true);
    setError(null);
    setPlan(null);
    setStepResults([]);
    setTxDigest(null);
    setStatus('idle');

    try {
      const orchestrator = new CrossProtocolOrchestrator({
        network: 'testnet',
        contractAddresses: {
          cetus_package: '0x...',
          navi_package: '0x...',
          sui_system: '0x3',
        },
      });

      await orchestrator.initialize();
      const parsedPlan = await orchestrator.parseIntent(intent);
      setPlan(parsedPlan);
      setStatus('parsed');
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    } finally {
      setIsParsing(false);
    }
  }, [intent]);

  const handleExecute = useCallback(async () => {
    if (!plan || !currentAccount) return;

    setIsExecuting(true);
    setError(null);
    setStepResults([]);
    setTxDigest(null);
    setStatus('executing');

    try {
      const orchestrator = new CrossProtocolOrchestrator({
        network: 'testnet',
        contractAddresses: {
          cetus_package: '0x...',
          navi_package: '0x...',
          sui_system: '0x3',
        },
      });

      await orchestrator.initialize();

      // 构建 PTB
      const tx = await orchestrator.buildPlanTransaction(plan, currentAccount.address);

      // 关键修复：必须设置 sender，否则钱包在解析 gas payment 时会失败
      tx.setSender(currentAccount.address);

      // 设置 Gas 预算
      tx.setGasBudget(10_000_000);

      // 使用钱包签名并执行
      signAndExecute(
        {
          transaction: tx,
          chain: 'sui:testnet',
        },
        {
          onSuccess: (result) => {
            const digest = result.digest;
            setTxDigest(digest);
            setStatus('success');

            const results: StepResult[] = plan.steps.map((step: any) => ({
              stepId: step.id,
              protocol: step.protocol,
              action: step.action,
              success: true,
              txDigest: digest,
            }));
            setStepResults(results);
          },
          onError: (err) => {
            setError(err.message);
            setStatus('error');

            const results: StepResult[] = plan.steps.map((step: any) => ({
              stepId: step.id,
              protocol: step.protocol,
              action: step.action,
              success: false,
              error: err.message,
            }));
            setStepResults(results);
          },
        }
      );
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    } finally {
      setIsExecuting(false);
    }
  }, [plan, currentAccount, signAndExecute]);

  const handleDryRun = useCallback(async () => {
    if (!plan || !currentAccount) return;

    setIsExecuting(true);
    setError(null);
    setStepResults([]);
    setTxDigest(null);
    setStatus('executing');

    try {
      const orchestrator = new CrossProtocolOrchestrator({
        network: 'testnet',
        contractAddresses: {
          cetus_package: '0x...',
          navi_package: '0x...',
          sui_system: '0x3',
        },
      });

      await orchestrator.initialize();

      // 构建 PTB
      const tx = await orchestrator.buildPlanTransaction(plan);

      // 构建交易字节
      const txBytes = await tx.build({ client: suiClient });

      // 模拟执行
      const dryRunResult = await suiClient.dryRunTransactionBlock({
        transactionBlock: txBytes,
      });

      const status = dryRunResult.effects.status.status;
      if (status === 'success') {
        setStatus('success');
        setStepResults(plan.steps.map((step: any) => ({
          stepId: step.id,
          protocol: step.protocol,
          action: step.action,
          success: true,
          txDigest: 'dry-run',
        })));
      } else {
        setStatus('error');
        setError(`Dry run failed: ${dryRunResult.effects.status.error}`);
        setStepResults(plan.steps.map((step: any) => ({
          stepId: step.id,
          protocol: step.protocol,
          action: step.action,
          success: false,
          error: dryRunResult.effects.status.error,
        })));
      }
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    } finally {
      setIsExecuting(false);
    }
  }, [plan, currentAccount, suiClient]);

  const presetIntents = [
    '在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC，最后将收益转入 0x0000000000000000000000000000000000000000000000000000000000000001',
    '在 Cetus 上卖出 SUI 买入 USDC',
    '在 Navi 上存入 SUI',
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center space-x-3 mb-2">
          <div className="p-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg shadow-lg">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Sui 测试网验证
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              在 Sui 测试网上验证 Cetus 和 Navi 的跨协议协同交易
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-xs text-gray-400">
          <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full font-medium">
            testnet
          </span>
          <span>{TESTNET_RPC}</span>
        </div>
      </div>

      {/* Wallet Status */}
      <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Wallet className={`w-5 h-5 ${currentAccount ? 'text-green-500' : 'text-gray-400'}`} />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {currentAccount ? '钱包已连接' : '未连接钱包'}
              </p>
              {currentAccount && (
                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                  {currentAccount.address}
                </p>
              )}
            </div>
          </div>
          {!currentAccount && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              请点击右上角 "Connect Wallet" 连接钱包
            </p>
          )}
        </div>
      </div>

      {/* Intent Input */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          输入 Sui 意图
        </label>
        <textarea
          className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm min-h-[80px]"
          placeholder='例如: "在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC"'
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          rows={3}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {presetIntents.map((preset, i) => (
            <button
              key={i}
              onClick={() => setIntent(preset)}
              className="px-3 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {preset.substring(0, 40)}...
            </button>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex space-x-3 mb-8">
        <button
          onClick={handleParseIntent}
          disabled={!intent.trim() || isParsing}
          className="flex items-center space-x-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-blue-500/20"
        >
          {isParsing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          <span>{isParsing ? '解析中...' : '解析意图'}</span>
        </button>

        {plan && (
          <>
            <button
              onClick={handleDryRun}
              disabled={!currentAccount || isExecuting}
              className="flex items-center space-x-2 px-6 py-2.5 bg-gray-600 text-white rounded-xl hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isExecuting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <AlertCircle className="w-4 h-4" />
              )}
              <span>模拟执行 (Dry Run)</span>
            </button>

            <button
              onClick={handleExecute}
              disabled={!currentAccount || isExecuting}
              className="flex items-center space-x-2 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-purple-500/20"
            >
              {isExecuting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              <span>签名并执行</span>
            </button>
          </>
        )}
      </div>

      {/* Plan Display */}
      {plan && (
        <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
            解析结果
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {plan.summary}
          </p>
          <div className="space-y-2">
            {plan.steps.map((step: any, index: number) => (
              <div
                key={step.id}
                className="flex items-center space-x-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
              >
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                    {index + 1}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {step.protocol}.{step.action}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {step.description}
                  </p>
                </div>
                {stepResults[index] && (
                  <div className="flex-shrink-0">
                    {stepResults[index].success ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-300">执行失败</p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-mono">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Success Display */}
      {txDigest && txDigest !== 'dry-run' && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
          <div className="flex items-start space-x-2">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                交易已发送到测试网!
              </p>
              <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-mono break-all">
                {txDigest}
              </p>
              <a
                href={`${EXPLORER_URL}/tx/${txDigest}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-1 mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                <span>在 SuiVision 上查看交易</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Step Results */}
      {stepResults.length > 0 && (
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
            执行结果
          </h3>
          <div className="space-y-2">
            {stepResults.map((result, index) => (
              <div
                key={result.stepId}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-2 h-2 rounded-full ${result.success ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {result.protocol}.{result.action}
                    </p>
                    {result.error && (
                      <p className="text-xs text-red-500 mt-0.5">{result.error}</p>
                    )}
                  </div>
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {result.success ? '✅ 成功' : '❌ 失败'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-xl">
        <h4 className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2">
          ℹ️ 说明
        </h4>
        <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-1">
          <li>• 需要连接 Sui 钱包（右上角 "Connect Wallet"）</li>
          <li>• 测试网 SUI 可从 https://faucet.sui.io/ 获取</li>
          <li>• "解析意图" 仅解析不执行，可查看计划详情</li>
          <li>• "模拟执行" 使用 dryRun 模拟交易，不实际发送</li>
          <li>• "签名并执行" 会弹出钱包签名确认窗口</li>
          <li>• 当前使用测试网 RPC: {TESTNET_RPC}</li>
        </ul>
      </div>
    </div>
  );
};

export default SuiTestnet;
