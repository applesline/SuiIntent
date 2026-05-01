import React, { useState, useEffect, useRef } from 'react';
import AIChatPanel from '../components/orchestration/AIChatPanel';
import StepPreviewBoard from '../components/orchestration/StepPreviewBoard';
import ExecutionResultPanel from '../components/orchestration/ExecutionResultPanel';
import StepEditorModal from '../components/orchestration/StepEditorModal';
import AIConfigModal from '../components/orchestration/AIConfigModal';
import { Toast } from '../components/ui';
import { useChatHistory } from '../hooks/useChatHistory';
import { useSuiIntent, getAIConfig } from '../hooks';
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
  const { t } = useLanguage();
  
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
          content: `⚠️ **AI 未配置**\n\n请先点击右上角 ⚙️ 按钮配置 AI 提供商和 API Key。\n\n配置后即可使用自然语言描述 Sui DeFi 操作。`,
        } : m
      ));
      setStatus('capability_missing');
      return;
    }

    // 步骤 2: 调用 daemon API 解析意图
    setAnalysisStatus('正在调用 LLM 解析 Sui 意图...');
    const parsedPlan = await parseSuiIntent(content);
    
    if (!parsedPlan) {
      setMessages(prev => prev.map(m => 
        m.id === loadingMessageId ? {
          ...m,
          content: `❌ **Sui 意图解析失败**\n\n${suiResult?.error || '无法解析该意图，请尝试重新描述。'}\n\n**示例：**\n\`\`\`\n在 Cetus 上卖出 0.1 SUI 买入 USDC，然后在 Navi 上存入 USDC\n\`\`\``,
        } : m
      ));
      setStatus('error');
      return;
    }

    // 步骤 3: 显示 LLM 解析的结构化计划
    let planSummary = `✅ **Sui 意图解析成功**\n\n**计划摘要：** ${parsedPlan.summary}\n\n**执行步骤：**\n`;
    for (let i = 0; i < parsedPlan.steps.length; i++) {
      const step = parsedPlan.steps[i];
      const deps = step.dependsOn.length > 0 ? ` (依赖: ${step.dependsOn.join(', ')})` : '';
      planSummary += `  ${i + 1}. **${step.toolName}**: ${step.description}${deps}\n`;
      
      // 显示参数
      const argKeys = Object.keys(step.arguments);
      if (argKeys.length > 0) {
        planSummary += `     \`参数: ${argKeys.map(k => `${k}=${step.arguments[k]}`).join(', ')}\`\n`;
      }
    }

    // 更新消息显示解析结果
    setMessages(prev => prev.map(m => 
      m.id === loadingMessageId ? {
        ...m,
        content: planSummary + '\n\n⏳ 准备执行...',
      } : m
    ));

    // 同步更新右侧 StepPreviewBoard 的 draftSteps
    const workflowSteps: WorkflowStep[] = parsedPlan.steps.map((step, index) => ({
      id: step.id || `step-${Date.now()}-${index}`,
      type: 'tool' as const,
      toolName: step.toolName,
      serverName: 'sui',
      parameters: {
        ...(step.arguments || {}),
        _description: step.description,
        _dependsOn: step.dependsOn || [],
      },
    }));
    setDraftSteps(workflowSteps);

    // 步骤 4: 检查钱包连接
    if (!isWalletConnected) {
      setMessages(prev => prev.map(m => 
        m.id === loadingMessageId ? {
          ...m,
          content: planSummary + `\n\n⚠️ **钱包未连接**\n\n请连接 Sui 钱包后重试。`,
        } : m
      ));
      setStatus('partial');
      return;
    }

    // 步骤 5: 先模拟执行
    setAnalysisStatus('正在模拟执行 Sui 交易...');
    const dryRunResult = await dryRunPlan();
    
    if (!dryRunResult.success) {
      // 模拟执行失败，但仍然显示计划，让用户可以选择继续执行
      // 注意：如果错误是 Navi 在 testnet 上不存在，用户需要切换到 mainnet
      const dryRunError = dryRunResult.error || '模拟执行完成（预期行为）';
      const isNaviTestnetError = dryRunError.includes('Navi Protocol is not deployed on Sui testnet');
      
      let dryRunMessage: string;
      if (isNaviTestnetError) {
        dryRunMessage = `\n\n⚠️ **模拟执行失败**\n\n${dryRunError}\n\n💡 **建议：** 当前使用 testnet 网络，但 Navi Protocol 在 testnet 上未部署。请切换到 mainnet 网络后重试。`;
      } else {
        dryRunMessage = `\n\n⚠️ **模拟执行结果**\n\n${dryRunError}\n\n可以继续执行实际交易。`;
      }
      
      setMessages(prev => prev.map(m => 
        m.id === loadingMessageId ? {
          ...m,
          content: planSummary + dryRunMessage,
        } : m
      ));
      setStatus('partial');
      // 不 return，让用户可以选择继续执行
    } else {
      // 模拟执行成功，继续执行实际交易
      // 步骤 6: 实际执行 - 通过钱包签名
      setAnalysisStatus('请在钱包中确认签名...');
      const execResult = await executeSuiPlan();

      if (execResult.success) {
        setStatus('success');
        
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

        const suiVisionUrl = network === 'mainnet'
          ? `https://suivision.xyz/tx/${execResult.txDigest}`
          : `https://testnet.suivision.xyz/tx/${execResult.txDigest}`;
        const suiScanUrl = network === 'mainnet'
          ? `https://suiscan.xyz/tx/${execResult.txDigest}`
          : `https://testnet.suiscan.xyz/tx/${execResult.txDigest}`;
        const resultContent = planSummary + `\n\n✅ **交易执行成功！**\n\n**交易摘要：** \`${execResult.txDigest}\`\n\n🔗 [在 SuiVision 上查看](${suiVisionUrl})\n🔗 [在 SuiScan 上查看](${suiScanUrl})`;

        setMessages(prev => prev.map(m => 
          m.id === loadingMessageId ? {
            ...m,
            content: resultContent,
            metadata: {
              isResult: true,
              executionSteps: stepResults,
              totalDuration: 0,
            },
          } : m
        ));
        
        showToast('Sui 交易执行成功！', 'success');
      } else {
        setStatus('error');
        
        setMessages(prev => prev.map(m => 
          m.id === loadingMessageId ? {
            ...m,
            content: planSummary + `\n\n❌ **执行失败**\n\n${execResult.error || '未知错误'}\n\n💡 **建议：**\n1. 确保钱包有足够的测试 SUI\n2. 从 https://faucet.sui.io/ 获取测试 SUI\n3. 重试`,
          } : m
        ));
      }
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

  // Handle the selected action
  const handleAction = async (action: 'execute' | 'save') => {
    if (draftSteps.length === 0) return;
    
    switch (action) {
      case 'execute':
        setExecutionStatus('executing');
        setExecutionResults(null);
        
        try {
          // Re-execute using the Sui intent engine
          const execResult = await executeSuiPlan();
          
          if (execResult.success) {
            setExecutionStatus('success');
            showToast('Workflow executed successfully!', 'success');
            
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
          } else {
            setExecutionStatus('error');
            showToast(`Workflow execution failed: ${execResult.error || 'Unknown error'}`, 'error');
          }
        } catch (error: any) {
          setExecutionStatus('error');
          showToast(`Workflow execution error: ${error.message || 'Unknown error'}`, 'error');
        }
        break;
        
      case 'save':
        showToast('Workflow saved for future reference', 'success');
        break;
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
    showToast('Step updated successfully', 'success');
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
            title="使用 Sui Testnet"
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
            title="使用 Sui Mainnet"
          >
            mainnet
          </button>
        </div>

        {/* AI 配置按钮 */}
        <button
          onClick={() => setShowAIConfig(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:shadow-md transition-all text-sm"
          title="配置 AI 提供商和 API Key"
        >
          <span className="text-lg">⚙️</span>
          <span className="text-gray-700 dark:text-gray-300 font-medium">AI 配置</span>
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
