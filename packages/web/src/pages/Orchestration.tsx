import React, { useState, useEffect, useRef, useCallback } from 'react';
import AIChatPanel from '../components/orchestration/AIChatPanel';
import StepPreviewBoard from '../components/orchestration/StepPreviewBoard';
import ExecutionResultPanel from '../components/orchestration/ExecutionResultPanel';
import StepEditorModal from '../components/orchestration/StepEditorModal';
import AIConfigModal from '../components/orchestration/AIConfigModal';
import { Toast } from '../components/ui';
import { useChatHistory } from '../hooks/useChatHistory';
import { useSuiIntent, getAIConfig } from '../hooks';
import type { SuiIntentResult } from '../hooks';
import { useLanguage } from '../contexts/LanguageContext';
import type { WorkflowStep } from '../types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  metadata?: {
    isStreaming?: boolean;
    isResult?: boolean;
    executionSteps?: StepResult[];
    totalDuration?: number;
  };
}

interface StepResult {
  name?: string;
  toolName?: string;
  serverName?: string;
  success: boolean;
  error?: string;
  duration?: number;
  output?: string;
  result?: unknown;
}

const Orchestration: React.FC = () => {
  const { t, language } = useLanguage();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [draftSteps, setDraftSteps] = useState<WorkflowStep[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'success' | 'capability_missing' | 'partial' | 'error'>('idle');
  const [executionStatus, setExecutionStatus] = useState<'idle' | 'executing' | 'success' | 'error'>('idle');
  const [actionSelection, setActionSelection] = useState<'execute' | 'save'>('execute');
  const [toast, setToast] = useState<{
    show: boolean;
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
  }>({
    show: false,
    message: '',
    type: 'success'
  });

  // AI 配置弹窗
  const [showAIConfig, setShowAIConfig] = useState(false);

  // Execution results state
  const [executionResults, setExecutionResults] = useState<StepResult[] | null>(null);
  const [executionTotalDuration, setExecutionTotalDuration] = useState(0);

  // Step editor state
  const [editingStep, setEditingStep] = useState<{ step: WorkflowStep; index: number } | null>(null);

  // Chat history persistence
  const { addMessages: persistMessages, createSession } = useChatHistory();
  const hasInitialized = useRef(false);

  // Sui Intent hook - 调用 daemon API 传递 apiKey
  const suiIntent = useSuiIntent();
  const { parseSuiIntent, dryRunPlan, executeSuiPlan, isWalletConnected, isParsing, isExecuting, plan, result: suiResult, network, setNetwork } = suiIntent;

  // Initialize chat session
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      createSession();
    }
  }, [createSession]);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      persistMessages(messages);
    }
  }, [messages, persistMessages]);

  const handleSendMessage = async (content: string) => {
    setIsAnalyzing(true);
    setAnalysisStatus(t('orchestration.analyzing'));
    setStatus('idle');
    setExecutionResults(null);
    
    try {
      // Add user message
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, userMessage]);
      
      // Add a streaming/loading assistant message
      const loadingMessageId = (Date.now() + 1).toString();
      const loadingMessage: Message = {
        id: loadingMessageId,
        role: 'assistant',
        content: '',
        metadata: { isStreaming: true },
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, loadingMessage]);

      // 使用 CloudIntentEngine + Sui MCP Tools 处理 Sui 意图
      await handleSuiIntent(content, loadingMessageId);
    } catch (error) {
      setStatus('error');
      
      const errorContent = getErrorMessage(error);
      
      // Update the loading message with error content
      setMessages(prev => prev.map(m => 
        m.metadata?.isStreaming ? {
          ...m,
          content: errorContent,
        } : m
      ));
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * 处理 Sui 意图 - 使用 CloudIntentEngine + Sui MCP Tools
   * 前端调用 daemon API 传递 apiKey，daemon 用完即弃
   */
  const handleSuiIntent = async (content: string, loadingMessageId: string) => {
    // 步骤 1: 检查 AI 配置
    const aiConfig = getAIConfig();
    if (!aiConfig || !aiConfig.apiKey) {
      setMessages(prev => prev.map(m => 
        m.id === loadingMessageId ? {
          ...m,
          content: t('suiIntent.aiConfigMissing'),
        } : m
      ));
      setStatus('capability_missing');
      return;
    }

    // 步骤 2: 调用 daemon API 解析意图
    setAnalysisStatus(t('suiIntent.analyzingPath'));
    const parsedPlan = await parseSuiIntent(content);
    
    if (!parsedPlan) {
      setMessages(prev => prev.map(m => 
        m.id === loadingMessageId ? {
          ...m,
          content: t('suiIntent.parseFailed'),
        } : m
      ));
      setStatus('error');
      return;
    }

    // 步骤 3: 格式化步骤展示 (优化体验)
    let planDetails = t('suiIntent.planReady', { count: String(parsedPlan.steps.length) });
    
    parsedPlan.steps.forEach((step, i) => {
      const toolName = step.toolName.replace('cetus_', 'Cetus ').replace('navi_', 'Navi ').replace('sui_', 'Sui ');
      const actionIcon = step.toolName.includes('swap') ? '🔄' : step.toolName.includes('deposit') ? '📥' : '➡️';
      
      planDetails += `${actionIcon} **${t('suiIntent.stepLabel', { index: String(i + 1) })}：${toolName}**\n`;
      
      // 精简并美化参数展示
      const args = step.arguments;
      if (step.toolName.includes('swap')) {
        planDetails += t('suiIntent.swapAction', { amount: args.amount, coinIn: args.coinTypeIn, coinOut: args.coinTypeOut });
        planDetails += t('suiIntent.swapSlippage', { slippage: (args.slippage * 100).toFixed(2) });
      } else if (step.toolName.includes('deposit')) {
        planDetails += t('suiIntent.depositAction', { amount: args.amount, coinType: args.coinType });
      } else {
        const argLines = Object.entries(args)
          .filter(([k]) => !k.startsWith('_'))
          .map(([k, v]) => `\`${k}=${v}\``)
          .join(' | ');
        planDetails += t('suiIntent.paramAction', { params: argLines });
      }
      planDetails += '\n';
    });

    // 同步更新右侧面板
    const workflowSteps: WorkflowStep[] = parsedPlan.steps.map((step, index) => ({
      id: step.id || `step-${Date.now()}-${index}`,
      type: 'tool' as const,
      toolName: step.toolName,
      serverName: 'sui',
      parameters: {
        ...(step.arguments || {}),
        _metadata: {
          description: step.description,
        }
      },
      dependsOn: step.dependsOn || [],
    } as any));
    setDraftSteps(workflowSteps);

    // 更新消息：显示初步计划
    setMessages(prev => prev.map(m => 
      m.id === loadingMessageId ? { ...m, content: planDetails + t('suiIntent.simulating') } : m
    ));

    // 步骤 4: 检查钱包连接
    if (!isWalletConnected) {
      setMessages(prev => prev.map(m => 
        m.id === loadingMessageId ? {
          ...m,
          content: planDetails + t('suiIntent.walletNotConnected'),
        } : m
      ));
      setStatus('partial');
      return;
    }

    // 步骤 5: 模拟执行 (Dry Run)
    setAnalysisStatus(t('suiIntent.stressTesting'));
    
    try {
      // 传入 parsedPlan 避免 React 状态异步更新导致 plan 为 null
      const dryRunResult = await dryRunPlan(parsedPlan);
      
      let dryRunStatusMsg = '';
      if (dryRunResult.success) {
        dryRunStatusMsg = t('suiIntent.dryRunSuccess');
        setStatus('success');
      } else {
        const isNaviError = dryRunResult.error?.includes('not deployed on Sui testnet');
        const hint = isNaviError ? t('suiIntent.dryRunHintSwitchMainnet') : t('suiIntent.dryRunHintForceGo');
        dryRunStatusMsg = t('suiIntent.dryRunError', { error: dryRunResult.error, hint });
        setStatus('partial');
      }

      setMessages(prev => prev.map(m => 
        m.id === loadingMessageId ? { ...m, content: planDetails + '---\n' + dryRunStatusMsg } : m
      ));
    } catch (e) {
      setMessages(prev => prev.map(m => 
        m.id === loadingMessageId ? { ...m, content: planDetails + t('suiIntent.dryRunUnavailable') } : m
      ));
      setStatus('partial');
    }
  };

  // Simplified error message generation
  const getErrorMessage = (error: unknown): string => {
    if (!(error instanceof Error)) {
      return t('orchestration.errorGeneric');
    }
    
    const msg = error.message.toLowerCase();
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection')) {
      return t('orchestration.errorNetwork');
    }
    if (msg.includes('auth') || msg.includes('401') || msg.includes('token')) {
      return t('orchestration.errorAuth');
    }
    if (msg.includes('server') || msg.includes('mcp')) {
      return t('orchestration.errorServer');
    }
    return `❌ **Error:** ${error.message}`;
  };

  /**
   * 将 draftSteps 保存为工作流
   * 使用 DAEMON_BASE_URL 确保请求发送到 daemon server（9658 端口），
   * 而不是 Vite dev server（5173 端口）
   * 需要携带 auth token（从 localStorage 获取），因为 /api/workflows 需要认证
   */
  const saveWorkflow = useCallback(async (execResult?: SuiIntentResult): Promise<string | null> => {
    try {
      const workflow = {
        name: `Sui Intent - ${new Date().toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}`,
        version: '1.0',
        description: plan?.summary || execResult?.plan?.summary || t('suiIntent.defaultDescription'),
        requirements: { servers: ['sui'] },
        inputs: [],
        steps: draftSteps,
        lastExecutedAt: execResult?.success ? new Date().toISOString() : undefined,
      };

      // 获取 auth token（用户登录时存储在 localStorage 中）
      const token = localStorage.getItem('auth_token');
      if (!token) {
        console.log('[Orchestration] No auth token found, skipping workflow save');
        return null;
      }

      const DAEMON_BASE_URL = 'http://localhost:9658';
      const response = await fetch(`${DAEMON_BASE_URL}/api/workflows`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(workflow),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || t('suiIntent.saveWorkflowError', { status: String(response.status) }));
      }

      const data = await response.json();
      const workflowId = data.workflow?.id || null;
      if (workflowId) {
        console.log(`[Orchestration] Workflow saved successfully with ID: ${workflowId}`);
      }
      return workflowId;
    } catch (error: any) {
      console.error('[Orchestration] Failed to save workflow:', error);
      return null;
    }
  }, [draftSteps, plan]);

  // Handle the selected action
  const handleAction = async (action: 'execute' | 'save') => {
    if (draftSteps.length === 0) return;
    
    switch (action) {
      case 'execute':
        setExecutionStatus('executing');
        setAnalysisStatus(t('suiIntent.confirmSignature'));
        setExecutionResults(null);
        
        try {
          // Re-execute using the Sui intent engine
          const execResult = await executeSuiPlan();
          
          if (execResult.success) {
            setExecutionStatus('success');
            showToast(t('suiIntent.executeSuccess'), 'success');
            
            const stepResults: StepResult[] = execResult.stepResults.map(sr => ({
              name: sr.toolName,
              toolName: sr.toolName,
              serverName: 'sui',
              success: sr.success,
              error: sr.error,
              duration: 0,
              result: { txDigest: sr.txDigest },
            }));
            
            setExecutionResults(stepResults);
            setExecutionTotalDuration(0);

            // 保存为工作流
            const workflowId = await saveWorkflow(execResult);
            if (workflowId) {
              console.log(`[Orchestration] Workflow saved with ID: ${workflowId}`);
            }

            // Add a new message to the chat with the result
            const suiVisionUrl = network === 'mainnet'
              ? `https://suivision.xyz/txblock/${execResult.txDigest}`
              : `https://testnet.suivision.xyz/txblock/${execResult.txDigest}`;
            const suiScanUrl = network === 'mainnet'
              ? `https://suiscan.xyz/mainnet/tx/${execResult.txDigest}`
              : `https://testnet.suiscan.xyz/tx/${execResult.txDigest}`;
            
            const resultContent: Message = {
              id: Date.now().toString(),
              role: 'assistant',
              content: t('suiIntent.txSuccess', { digest: execResult.txDigest, suiVisionUrl, suiScanUrl }),
              timestamp: new Date().toISOString(),
              metadata: {
                isResult: true,
                executionSteps: stepResults,
              }
            };
            setMessages(prev => [...prev, resultContent]);
          } else {
            setExecutionStatus('error');
            const errorMsg = execResult.error || t('suiIntent.unknownError');
            showToast(t('suiIntent.executeFailed', { error: errorMsg }), 'error');
            
            const errorContent: Message = {
              id: Date.now().toString(),
              role: 'assistant',
              content: t('suiIntent.txFailed', { error: errorMsg }),
              timestamp: new Date().toISOString(),
            };
            setMessages(prev => [...prev, errorContent]);
          }
        } catch (error: any) {
          setExecutionStatus('error');
          showToast(t('suiIntent.executeError', { error: error.message }), 'error');
        } finally {
          setAnalysisStatus('');
        }
        break;
        
      case 'save': {
        // 保存为工作流（不执行）
        const workflowId = await saveWorkflow();
        if (workflowId) {
          showToast(t('suiIntent.workflowSavedToast', { id: workflowId }), 'success');
          
          const saveContent: Message = {
            id: Date.now().toString(),
            role: 'assistant',
            content: t('suiIntent.workflowSaved', { count: String(draftSteps.length) }),
            timestamp: new Date().toISOString(),
          };
          setMessages(prev => [...prev, saveContent]);
        } else {
          showToast(t('suiIntent.saveWorkflowFailed'), 'error');
        }
        break;
      }
    }
  };

  // Retry failed steps
  const handleRetry = () => {
    setExecutionResults(null);
    handleAction('execute');
  };

  const handleActionChange = (action: 'execute' | 'save') => {
    setActionSelection(action);
  };

  const handleClear = () => {
    setDraftSteps([]);
    setStatus('idle');
    setExecutionResults(null);
  };

  const handleDeleteStep = (id: string) => {
    setDraftSteps(prev => prev.filter(step => step.id !== id));
  };

  // Step editing
  const handleEditStep = (step: WorkflowStep) => {
    const index = draftSteps.findIndex(s => s.id === step.id);
    if (index >= 0) {
      setEditingStep({ step, index });
    }
  };

  const handleSaveEditedStep = (editedStep: WorkflowStep) => {
    setDraftSteps(prev => prev.map((s, i) => 
      i === editingStep?.index ? editedStep : s
    ));
    setEditingStep(null);
    showToast(t('suiIntent.stepUpdated'), 'success');
  };

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') => {
    setToast({ show: true, message, type });
  };

  const closeToast = () => {
    setToast(prev => ({ ...prev, show: false }));
  };

  return (
    <div className="flex flex-col h-[calc(100vh-130px)] -m-6 overflow-hidden">
      {/* 顶部工具栏：网络选择 + AI 配置 */}
      <div className="absolute top-4 right-4 z-10 flex items-center space-x-3">
        {/* 网络选择器 */}
        <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
          <button
            onClick={() => setNetwork('testnet')}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              network === 'testnet'
                ? 'bg-blue-500 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={t('suiIntent.networkTestnet')}
          >
            testnet
          </button>
          <button
            onClick={() => setNetwork('mainnet')}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              network === 'mainnet'
                ? 'bg-green-500 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title={t('suiIntent.networkMainnet')}
          >
            mainnet
          </button>
        </div>

        {/* AI 配置按钮 */}
        <button
          onClick={() => setShowAIConfig(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:shadow-md transition-all text-sm"
          title={t('suiIntent.aiConfigTitle')}
        >
          <span className="text-lg">⚙️</span>
          <span className="text-gray-700 dark:text-gray-300 font-medium">{t('suiIntent.aiConfigButton')}</span>
          {getAIConfig()?.apiKey ? (
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
          ) : (
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
          )}
        </button>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: AI Chat Panel - 60% width */}
        <div className="flex-[6] min-w-0">
          <AIChatPanel 
            onSendMessage={handleSendMessage}
            messages={messages}
            isAnalyzing={isAnalyzing}
            statusMessage={analysisStatus}
          />
        </div>

        {/* Right: Step Preview Board - 40% width */}
        <div className="flex-[4] flex flex-col min-w-0 overflow-hidden">
          <StepPreviewBoard 
            steps={draftSteps}
            status={status}
            onClear={handleClear}
            onDeleteStep={handleDeleteStep}
            onEditStep={handleEditStep}
            onAddStep={() => {
              const newStep: WorkflowStep = {
                id: `step-${Date.now()}`,
                type: 'tool',
                toolName: '',
                serverName: '',
                parameters: {},
              };
              setDraftSteps(prev => [...prev, newStep]);
              setEditingStep({ step: newStep, index: draftSteps.length });
            }}
            actionSelection={actionSelection}
            onActionChange={handleActionChange}
            onActionExecute={() => handleAction(actionSelection)}
            isExecuting={executionStatus === 'executing'}
          />

          {/* Execution Results Panel */}
          {executionResults && executionResults.length > 0 && (
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 overflow-y-auto max-h-[40vh]">
              <ExecutionResultPanel
                results={executionResults}
                totalDuration={executionTotalDuration}
                onClose={() => setExecutionResults(null)}
                onRetry={handleRetry}
              />
            </div>
          )}
        </div>
      </div>

      {/* Step Editor Modal */}
      {editingStep && (
        <StepEditorModal
          step={editingStep.step}
          index={editingStep.index}
          onSave={handleSaveEditedStep}
          onClose={() => setEditingStep(null)}
        />
      )}

      {/* AI 配置弹窗 */}
      <AIConfigModal
        isOpen={showAIConfig}
        onClose={() => setShowAIConfig(false)}
      />

      {/* Toast */}
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={closeToast}
        />
      )}
    </div>
  );
};

export default Orchestration;
