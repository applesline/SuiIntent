import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Plus, 
  Search, 
  Filter,
  PlayCircle,
  Edit,
  Trash2,
  Copy,
  MoreVertical,
  Clock,
  Layers,
  GitBranch,
  CheckCircle,
  AlertCircle,
  Calendar,
  Download,
  Upload,
  X,
  Check,
  XCircle,
  Loader2
} from 'lucide-react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import { apiService } from '../services/api';
import { formatRelativeTime } from '../utils/format';
import { useLanguage } from '../contexts/LanguageContext';
import type { Workflow, WorkflowStep } from '../types';
import toast from 'react-hot-toast';
import WorkflowVisualizer from '../components/workflows/WorkflowVisualizer';

const DAEMON_BASE_URL = 'http://localhost:9658';

/**
 * 判断工作流是否为 Sui DeFi 相关工作流
 * Sui 工作流的步骤 serverName 为 'sui' 或工具名包含 cetus_/navi_/sui_
 */
function isSuiWorkflow(workflow: Workflow): boolean {
  return (workflow.steps || []).some(step =>
    step.serverName === 'sui' ||
    (step.toolName && /^(cetus|navi|sui)_/.test(step.toolName))
  );
}

const Workflows: React.FC = () => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [newWorkflow, setNewWorkflow] = useState({
    name: '',
    description: '',
  });
  const [executionResults, setExecutionResults] = useState<{
    workflowId: string;
    results: Array<{
      toolName: string;
      status: 'success' | 'error';
      output?: any;
      error?: string;
    }>;
    totalSteps: number;
    success: boolean;
    timestamp: string;
  } | null>(null);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [isSuiExecuting, setIsSuiExecuting] = useState(false);

  // Get workflow list
  const { data: workflows = [], isLoading, refetch } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => apiService.getWorkflows(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Create workflow mutation
  const createWorkflowMutation = useMutation({
    mutationFn: () => apiService.saveWorkflow({
      id: '',
      name: newWorkflow.name,
      version: '1.0.0',
      description: newWorkflow.description,
      requirements: {
        servers: []
      },
      inputs: [],
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setShowCreateModal(false);
      setNewWorkflow({ name: '', description: '' });
    },
  });

  // Delete workflow mutation
  const deleteWorkflowMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteWorkflow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });

  // Execute workflow mutation
  const executeWorkflowMutation = useMutation({
    mutationFn: (id: string) => apiService.executeWorkflow({ workflowId: id }),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      
      // Store execution results for display
      setExecutionResults({
        workflowId: variables, // variables is the id passed to mutationFn
        results: data.results || [],
        totalSteps: data.totalSteps || 0,
        success: data.success || false,
        timestamp: new Date().toISOString()
      });
      
      // Show success notification instead of alert
      toast.success('Workflow executed successfully', {
        duration: 3000,
        position: 'top-right'
      });
    },
    onError: (error) => {
      toast.error(`Failed to execute workflow: ${error}`, {
        duration: 5000,
        position: 'top-right'
      });
    },
  });

  // Duplicate workflow mutation
  const duplicateWorkflowMutation = useMutation({
    mutationFn: (workflow: Workflow) => {
      // Create a copy of the workflow with a new name and ID
      const duplicatedWorkflow = {
        ...workflow,
        id: '', // Let backend generate new ID
        name: `${workflow.name} (Copy)`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return apiService.saveWorkflow(duplicatedWorkflow);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });

  // Filter workflows
  const filteredWorkflows = workflows.filter(workflow => {
    // Safe handling: ensure name and description exist
    const name = workflow.name || '';
    const description = workflow.description || '';
    const searchTermLower = searchTerm.toLowerCase();
    
    const matchesSearch = name.toLowerCase().includes(searchTermLower) ||
                         description.toLowerCase().includes(searchTermLower);
    
    // Apply status filter
    let matchesStatus = true;
    switch (statusFilter) {
      case 'hasSteps':
        matchesStatus = workflow.steps && workflow.steps.length > 0;
        break;
      case 'executed':
        matchesStatus = !!workflow.lastExecutedAt;
        break;
      case 'neverExecuted':
        matchesStatus = !workflow.lastExecutedAt;
        break;
      case 'all':
      default:
        matchesStatus = true;
        break;
    }
    
    return matchesSearch && matchesStatus;
  });

  // Statistics
  const stats = {
    total: workflows.length,
    active: workflows.filter(w => w.lastExecutedAt).length,
    neverExecuted: workflows.filter(w => !w.lastExecutedAt).length,
    hasSteps: workflows.filter(w => w.steps.length > 0).length,
  };

  // Handle create workflow
  const handleCreateWorkflow = () => {
    if (!newWorkflow.name.trim()) {
      alert('Please enter workflow name');
      return;
    }
    createWorkflowMutation.mutate();
  };

  // Handle delete workflow
  const handleDeleteWorkflow = (id: string, name: string) => {
    if (window.confirm(t('workflows.confirmDelete', { name }))) {
      deleteWorkflowMutation.mutate(id);
    }
  };

  /**
   * 通过 daemon API 构建 Sui PTB 交易并让钱包签名执行
   */
  const executeSuiWorkflow = async (workflow: Workflow): Promise<{
    success: boolean;
    results: Array<{ toolName: string; status: 'success' | 'error'; output?: any; error?: string }>;
    totalSteps: number;
  }> => {
    if (!currentAccount) {
      throw new Error('请先连接 Sui 钱包');
    }

    setIsSuiExecuting(true);

    try {
      // 将工作流步骤转换为 plan 格式
      const plan = {
        id: `plan_${Date.now()}`,
        summary: workflow.name || 'Workflow execution',
        steps: (workflow.steps || []).map((step, index) => ({
          id: step.id || `step_${index}`,
          toolName: step.toolName,
          description: step.description || '',
          arguments: step.parameters || {},
          dependsOn: step.dependsOn || [],
        })),
      };

      // 确定网络（从步骤参数中推断，默认 mainnet）
      const network = workflow.steps?.some(s => 
        s.parameters?._metadata?.network === 'testnet'
      ) ? 'testnet' as const : 'mainnet' as const;

      // 步骤 1: 调用 daemon API 构建 PTB 交易
      const buildResponse = await fetch(`${DAEMON_BASE_URL}/api/sui/build-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: {
            id: plan.id,
            summary: plan.summary,
            steps: plan.steps,
          },
          signerAddress: currentAccount.address,
          network,
        }),
      });

      if (!buildResponse.ok) {
        const errorData = await buildResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `构建交易失败 (${buildResponse.status})`);
      }

      const buildData = await buildResponse.json();
      if (!buildData.success || !buildData.txBytes) {
        throw new Error(buildData.error || '构建交易失败');
      }

      // 步骤 2: 解码 txBytes 并创建 Transaction 对象
      const txBytes = fromBase64(buildData.txBytes);
      const tx = Transaction.fromKind(txBytes);
      tx.setSender(currentAccount.address);

      // 步骤 3: 通过钱包签名并执行
      const txResult = await signAndExecuteTransaction({
        transaction: tx,
        chain: network === 'mainnet' ? 'sui:mainnet' : 'sui:testnet',
      });

      const digest = txResult.digest;

      // 步骤 4: 返回结果
      const results = plan.steps.map((step) => ({
        toolName: step.toolName,
        status: 'success' as const,
        output: { txDigest: digest },
      }));

      return {
        success: true,
        results,
        totalSteps: results.length,
      };
    } catch (error: any) {
      const results = (workflow.steps || []).map((step) => ({
        toolName: step.toolName,
        status: 'error' as const,
        error: error.message,
      }));

      return {
        success: false,
        results,
        totalSteps: results.length,
      };
    } finally {
      setIsSuiExecuting(false);
    }
  };

  // Handle execute workflow
  const handleExecuteWorkflow = async (id: string, name: string) => {
    // 查找工作流
    const workflow = workflows.find(w => w.id === id);
    if (!workflow) {
      toast.error('Workflow not found');
      return;
    }

    // 判断是否为 Sui 相关工作流
    if (isSuiWorkflow(workflow)) {
      // Sui 工作流：使用钱包签名流程
      if (!currentAccount) {
        toast.error(t('workflows.connectWallet'), { duration: 5000 });
        return;
      }

      try {
        const suiResult = await executeSuiWorkflow(workflow);
        
        // 更新工作流的 lastExecutedAt
        try {
          await apiService.saveWorkflow({
            ...workflow,
            lastExecutedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          queryClient.invalidateQueries({ queryKey: ['workflows'] });
        } catch (updateError) {
          console.warn('[Workflows] Failed to update workflow lastExecutedAt:', updateError);
        }

        // 存储执行结果
        setExecutionResults({
          workflowId: id,
          results: suiResult.results,
          totalSteps: suiResult.totalSteps,
          success: suiResult.success,
          timestamp: new Date().toISOString(),
        });

        if (suiResult.success) {
          toast.success('Workflow executed successfully via Sui wallet', { duration: 3000 });
        } else {
          toast.error(`Workflow execution failed: ${suiResult.results[0]?.error || 'Unknown error'}`, { duration: 5000 });
        }

        // 自动显示结果弹窗
        setTimeout(() => setShowResultsModal(true), 500);
      } catch (error: any) {
        toast.error(`Failed to execute Sui workflow: ${error.message}`, { duration: 5000 });
      }
    } else {
      // 非 Sui 工作流：使用原有的 MCP 工具调用流程
      executeWorkflowMutation.mutate(id, {
        onSuccess: () => {
          setTimeout(() => setShowResultsModal(true), 500);
        }
      });
    }
  };

  // Handle edit workflow
  const handleEditWorkflow = (workflow: Workflow) => {
    setSelectedWorkflow(workflow);
    setShowEditModal(true);
  };

  // Handle duplicate workflow
  const handleDuplicateWorkflow = (workflow: Workflow) => {
    if (window.confirm(`Are you sure you want to duplicate workflow "${workflow.name}"?`)) {
      duplicateWorkflowMutation.mutate(workflow);
    }
  };

  // Update workflow mutation
  const updateWorkflowMutation = useMutation({
    mutationFn: (updatedWorkflow: Workflow) => apiService.saveWorkflow(updatedWorkflow),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setShowEditModal(false);
      setSelectedWorkflow(null);
    },
  });

  // Handle save workflow changes
  const handleSaveWorkflowChanges = () => {
    if (!selectedWorkflow) return;
    
    // Create updated workflow object
    const updatedWorkflow = {
      ...selectedWorkflow,
      updatedAt: new Date().toISOString(),
    };
    
    updateWorkflowMutation.mutate(updatedWorkflow);
  };

  // Handle download workflow
  const handleDownloadWorkflow = (workflow: Workflow) => {
    try {
      // Create a clean workflow object for export
      const exportWorkflow = {
        ...workflow,
        // Remove any internal fields that shouldn't be exported
      };
      
      // Convert to JSON string
      const workflowJson = JSON.stringify(exportWorkflow, null, 2);
      
      // Create blob and download link
      const blob = new Blob([workflowJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${workflow.name.replace(/\s+/g, '_')}_workflow.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      alert(`Workflow "${workflow.name}" downloaded successfully`);
    } catch (error) {
      alert(`Failed to download workflow: ${error}`);
    }
  };

  // Handle upload workflow
  const handleUploadWorkflow = () => {
    // Create file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const workflowData = JSON.parse(text);
        
        // Validate basic workflow structure
        if (!workflowData.name || typeof workflowData.name !== 'string') {
          alert('Invalid workflow file: missing or invalid name field');
          return;
        }
        
        // Create new workflow from uploaded data
        const newWorkflowFromFile = {
          ...workflowData,
          id: '', // Let backend generate new ID
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        
        // Save the workflow
        await apiService.saveWorkflow(newWorkflowFromFile);
        queryClient.invalidateQueries({ queryKey: ['workflows'] });
        
        alert(`Workflow "${workflowData.name}" imported successfully`);
      } catch (error) {
        alert(`Failed to import workflow: ${error}`);
      }
    };
    
    input.click();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t('workflows.title')}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {t('workflows.description')}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('workflows.createWorkflow')}</span>
        </button>
      </div>

      {/* Statistics cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('workflows.totalWorkflows')}</p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{stats.total}</p>
            </div>
            <div className="bg-blue-500 p-3 rounded-lg">
              <Layers className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('workflows.executedWorkflows')}</p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{stats.active}</p>
            </div>
            <div className="bg-green-500 p-3 rounded-lg">
              <CheckCircle className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('workflows.neverExecutedWorkflows')}</p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{stats.neverExecuted}</p>
            </div>
            <div className="bg-yellow-500 p-3 rounded-lg">
              <AlertCircle className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('workflows.workflowsWithSteps')}</p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{stats.hasSteps}</p>
            </div>
            <div className="bg-purple-500 p-3 rounded-lg">
              <GitBranch className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Search and filter */}
      <div className="card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder={t('workflows.searchPlaceholder')}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Filter className="w-5 h-5 text-gray-400" />
              <select
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">{t('workflows.filterAll')}</option>
                <option value="hasSteps">{t('workflows.filterHasSteps')}</option>
                <option value="executed">{t('workflows.filterExecuted')}</option>
                <option value="neverExecuted">{t('workflows.filterNeverExecuted')}</option>
              </select>
            </div>
            
            <div className="flex space-x-2">
              <button 
                onClick={() => {
                  // Download all workflows as a JSON file
                  try {
                    const workflowsJson = JSON.stringify(workflows, null, 2);
                    const blob = new Blob([workflowsJson], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `workflows_export_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    alert(`Exported ${workflows.length} workflows successfully`);
                  } catch (error) {
                    alert(`Failed to export workflows: ${error}`);
                  }
                }}
                className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                title={t('workflows.exportAll')}
              >
                <Download className="w-5 h-5" />
              </button>
              <button 
                onClick={handleUploadWorkflow}
                className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                title={t('workflows.importWorkflow')}
              >
                <Upload className="w-5 h-5" />
              </button>
              <button
                onClick={() => refetch()}
                className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                title={t('common.refresh')}
              >
                <Search className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Workflow list */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredWorkflows.length > 0 ? (
          filteredWorkflows.map((workflow) => (
            <div key={workflow.id} className="card hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <Layers className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white">{workflow.name}</h3>
                    <p className="text-sm text-gray-500">{workflow.id}</p>
                  </div>
                </div>
                <div className="relative">
                  <button 
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    onClick={(e) => {
                      // Toggle dropdown for this workflow
                      const dropdownId = `dropdown-${workflow.id}`;
                      const dropdown = document.getElementById(dropdownId);
                      if (dropdown) {
                        dropdown.classList.toggle('hidden');
                      }
                    }}
                  >
                    <MoreVertical className="w-5 h-5 text-gray-500" />
                  </button>
                  <div 
                    id={`dropdown-${workflow.id}`}
                    className="hidden absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10"
                  >
                    <div className="py-1">
                      <button
                        onClick={() => {
                          handleDuplicateWorkflow(workflow);
                          document.getElementById(`dropdown-${workflow.id}`)?.classList.add('hidden');
                        }}
                        className="flex items-center w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Copy className="w-4 h-4 mr-2" />
                        Duplicate
                      </button>
                      <button
                        onClick={() => {
                          handleDownloadWorkflow(workflow);
                          document.getElementById(`dropdown-${workflow.id}`)?.classList.add('hidden');
                        }}
                        className="flex items-center w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Export as JSON
                      </button>
                      <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                      <button
                        onClick={() => {
                          handleDeleteWorkflow(workflow.id, workflow.name);
                          document.getElementById(`dropdown-${workflow.id}`)?.classList.add('hidden');
                        }}
                        className="flex items-center w-full px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-gray-600 dark:text-gray-400 text-sm mb-4 line-clamp-2">
                {workflow.description || 'No description'}
              </p>

              <div className="space-y-3 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center text-gray-500">
                    <GitBranch className="w-4 h-4 mr-2" />
                    <span>Steps</span>
                  </div>
                  <span className="font-medium">{workflow.steps.length}</span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center text-gray-500">
                    <Calendar className="w-4 h-4 mr-2" />
                    <span>Created</span>
                  </div>
                  <span>{formatRelativeTime(workflow.createdAt)}</span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center text-gray-500">
                    <Clock className="w-4 h-4 mr-2" />
                    <span>Last executed</span>
                  </div>
                  <span>
                    {workflow.lastExecutedAt ? formatRelativeTime(workflow.lastExecutedAt) : 'Never executed'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleExecuteWorkflow(workflow.id, workflow.name)}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm"
                  >
                    <PlayCircle className="w-4 h-4" />
                    <span>Execute</span>
                  </button>
                  <button
                    onClick={() => handleEditWorkflow(workflow)}
                    className="flex items-center space-x-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
                  >
                    <Edit className="w-4 h-4" />
                    <span>Edit</span>
                  </button>
                </div>
                <div className="flex space-x-1">
                  <button
                    onClick={() => handleDuplicateWorkflow(workflow)}
                    className="p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    title={t('workflows.duplicate')}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteWorkflow(workflow.id, workflow.name)}
                    className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                    title={t('common.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-3">
            <div className="card text-center py-12">
              <Layers className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">{t('workflows.noWorkflows')}</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                {searchTerm ? 'No matching workflows found' : 'No workflows created yet'}
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Create first workflow</span>
              </button>
            </div>
          </div>
        )}
      </div>


      {/* Create workflow modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Create Workflow</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Create a new automation workflow</p>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Workflow Name *
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="e.g., Data Preprocessing Pipeline"
                  value={newWorkflow.name}
                  onChange={(e) => setNewWorkflow({...newWorkflow, name: e.target.value})}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Description (Optional)
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Describe the purpose and functionality of this workflow"
                  rows={3}
                  value={newWorkflow.description}
                  onChange={(e) => setNewWorkflow({...newWorkflow, description: e.target.value})}
                />
              </div>
            </div>
            
            <div className="flex items-center justify-end p-6 border-t border-gray-200 dark:border-gray-700 space-x-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWorkflow}
                disabled={createWorkflowMutation.isPending}
                className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createWorkflowMutation.isPending ? 'Creating...' : 'Create Workflow'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit workflow modal */}
      {showEditModal && selectedWorkflow && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">{t('workflows.editModalTitle')}: {selectedWorkflow.name}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('workflows.workflowId')}: {selectedWorkflow.id} • {t('workflows.steps')}: {selectedWorkflow.steps?.length || 0}
                </p>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <AlertCircle className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Basic information */}
                <div className="lg:col-span-1 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Workflow Name *
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Workflow name"
                      value={selectedWorkflow.name || ''}
                      onChange={(e) => setSelectedWorkflow({
                        ...selectedWorkflow,
                        name: e.target.value
                      })}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Description (Optional)
                    </label>
                    <textarea
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Describe the purpose and functionality of this workflow"
                      rows={3}
                      value={selectedWorkflow.description || ''}
                      onChange={(e) => setSelectedWorkflow({
                        ...selectedWorkflow,
                        description: e.target.value
                      })}
                    />
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                      <div className="flex justify-between">
                        <span>Created:</span>
                        <span>{formatRelativeTime(selectedWorkflow.createdAt)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Last updated:</span>
                        <span>{formatRelativeTime(selectedWorkflow.updatedAt)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Last executed:</span>
                        <span>
                          {selectedWorkflow.lastExecutedAt ? formatRelativeTime(selectedWorkflow.lastExecutedAt) : 'Never executed'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Steps editor */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Workflow Graph Visualization */}
                  <div>
                    <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Workflow Visualization</h4>
                    <WorkflowVisualizer workflow={selectedWorkflow} />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-medium text-gray-900 dark:text-white">Workflow Steps</h4>
                    <button
                      onClick={() => {
                        // Add a new step
                        const newStep: WorkflowStep = {
                          id: `step-${Date.now()}`,
                          type: 'tool',
                          toolName: '',
                          parameters: {},
                        };
                        setSelectedWorkflow({
                          ...selectedWorkflow,
                          steps: [...(selectedWorkflow.steps || []), newStep]
                        });
                      }}
                      className="flex items-center space-x-1 px-3 py-1.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Step</span>
                    </button>
                  </div>

                  {selectedWorkflow.steps && selectedWorkflow.steps.length > 0 ? (
                    <div className="space-y-4">
                      {selectedWorkflow.steps.map((step, index) => (
                        <div key={step.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center space-x-2">
                              <div className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-xs font-medium rounded">
                                Step {index + 1}
                              </div>
                              <span className="text-sm text-gray-600 dark:text-gray-400">
                                {step.type === 'server' ? 'Server' : 
                                 step.type === 'tool' ? 'Tool' : 
                                 step.type === 'condition' ? 'Condition' : 'Loop'}
                              </span>
                            </div>
                            <div className="flex space-x-1">
                              <button
                                onClick={() => {
                                  // Move step up
                                  if (index > 0) {
                                    const newSteps = [...selectedWorkflow.steps];
                                    [newSteps[index], newSteps[index - 1]] = [newSteps[index - 1], newSteps[index]];
                                    setSelectedWorkflow({
                                      ...selectedWorkflow,
                                      steps: newSteps
                                    });
                                  }
                                }}
                                disabled={index === 0}
                                className="p-1 text-gray-500 hover:text-gray-700 disabled:opacity-30"
                                title={t('workflows.moveUp')}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                              </button>
                              <button
                                onClick={() => {
                                  // Move step down
                                  if (index < selectedWorkflow.steps.length - 1) {
                                    const newSteps = [...selectedWorkflow.steps];
                                    [newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]];
                                    setSelectedWorkflow({
                                      ...selectedWorkflow,
                                      steps: newSteps
                                    });
                                  }
                                }}
                                disabled={index === selectedWorkflow.steps.length - 1}
                                className="p-1 text-gray-500 hover:text-gray-700 disabled:opacity-30"
                                title={t('workflows.moveDown')}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              <button
                                onClick={() => {
                                  // Delete step
                                  const newSteps = selectedWorkflow.steps.filter((_, i) => i !== index);
                                  setSelectedWorkflow({
                                    ...selectedWorkflow,
                                    steps: newSteps
                                  });
                                }}
                                className="p-1 text-red-500 hover:text-red-700"
                                title={t('common.delete')}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Step Type
                              </label>
                              <select
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                value={step.type}
                                onChange={(e) => {
                                  const newSteps = [...selectedWorkflow.steps];
                                  newSteps[index] = {
                                    ...newSteps[index],
                                    type: e.target.value as 'server' | 'tool' | 'condition' | 'loop'
                                  };
                                  setSelectedWorkflow({
                                    ...selectedWorkflow,
                                    steps: newSteps
                                  });
                                }}
                              >
                                <option value="tool">Tool</option>
                                <option value="server">Server</option>
                                <option value="condition">Condition</option>
                                <option value="loop">Loop</option>
                              </select>
                            </div>

                            {step.type === 'server' && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                  Server Name
                                </label>
                                <input
                                  type="text"
                                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                  placeholder="Enter server name"
                                  value={step.serverName || ''}
                                  onChange={(e) => {
                                    const newSteps = [...selectedWorkflow.steps];
                                    newSteps[index] = {
                                      ...newSteps[index],
                                      serverName: e.target.value
                                    };
                                    setSelectedWorkflow({
                                      ...selectedWorkflow,
                                      steps: newSteps
                                    });
                                  }}
                                />
                              </div>
                            )}

                            {step.type === 'tool' && (
                              <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                  Tool Name
                                </label>
                                <input
                                  type="text"
                                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                  placeholder="Enter tool name"
                                  value={step.toolName || ''}
                                  onChange={(e) => {
                                    const newSteps = [...selectedWorkflow.steps];
                                    newSteps[index] = {
                                      ...newSteps[index],
                                      toolName: e.target.value
                                    };
                                    setSelectedWorkflow({
                                      ...selectedWorkflow,
                                      steps: newSteps
                                    });
                                  }}
                                />
                              </div>
                            )}

                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Parameters (JSON)
                              </label>
                              <textarea
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono text-sm"
                                placeholder='{"key": "value"}'
                                rows={3}
                                value={step.parameters ? JSON.stringify(step.parameters, null, 2) : '{}'}
                                onChange={(e) => {
                                  try {
                                    const params = JSON.parse(e.target.value || '{}');
                                    const newSteps = [...selectedWorkflow.steps];
                                    newSteps[index] = {
                                      ...newSteps[index],
                                      parameters: params
                                    };
                                    setSelectedWorkflow({
                                      ...selectedWorkflow,
                                      steps: newSteps
                                    });
                                  } catch (error) {
                                    // Keep invalid JSON for user to fix
                                  }
                                }}
                              />
                              <p className="text-xs text-gray-500 mt-1">Enter valid JSON object</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                      <Layers className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                      <p className="text-gray-600 dark:text-gray-400">No steps defined for this workflow</p>
                      <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">Add steps to create an automation workflow</p>
                    </div>
                  )}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
              <div className="text-sm text-gray-500">
                Last updated: {formatRelativeTime(selectedWorkflow.updatedAt)}
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveWorkflowChanges}
                  disabled={updateWorkflowMutation.isPending || !selectedWorkflow.name?.trim()}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updateWorkflowMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Execution results modal */}
      {showResultsModal && executionResults && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">Workflow Execution Results</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Executed at: {formatRelativeTime(executionResults.timestamp)} • 
                  Steps: {executionResults.totalSteps} • 
                  Status: {executionResults.success ? 'Success' : 'Failed'}
                </p>
              </div>
              <button
                onClick={() => setShowResultsModal(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-6">
              <div className="space-y-4">
                {/* Summary */}
                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-900 dark:text-white">
                        {executionResults.totalSteps}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">Total Steps</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {executionResults.results.filter(r => r.status === 'success').length}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">Successful</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                        {executionResults.results.filter(r => r.status === 'error').length}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">Failed</div>
                    </div>
                  </div>
                </div>

                {/* Detailed results */}
                <div className="space-y-3">
                  <h4 className="font-medium text-gray-900 dark:text-white">Step-by-Step Results</h4>
                  {executionResults.results.map((result, index) => (
                    <div key={index} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <div className={`p-1 rounded-full ${result.status === 'success' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                            {result.status === 'success' ? (
                              <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                            )}
                          </div>
                          <span className="font-medium text-gray-900 dark:text-white">
                            Step {index + 1}: {result.toolName}
                          </span>
                        </div>
                        <span className={`px-2 py-1 text-xs font-medium rounded ${result.status === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'}`}>
                          {result.status === 'success' ? 'Success' : 'Failed'}
                        </span>
                      </div>
                      
                      {result.status === 'success' ? (
                        <div className="mt-2">
                          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Output:</div>
                          <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded text-sm overflow-auto max-h-40">
                            <pre className="whitespace-pre-wrap break-words font-mono">
                              {typeof result.output === 'object' 
                                ? JSON.stringify(result.output, null, 2)
                                : String(result.output || 'No output')
                              }
                            </pre>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2">
                          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Error:</div>
                          <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded text-sm text-red-700 dark:text-red-400 whitespace-pre-wrap break-words">
                            {result.error || 'Unknown error'}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Export results */}
                <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => {
                      try {
                        const resultsJson = JSON.stringify(executionResults, null, 2);
                        const blob = new Blob([resultsJson], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `workflow_results_${new Date().toISOString().split('T')[0]}.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        toast.success('Results exported successfully');
                      } catch (error) {
                        toast.error('Failed to export results');
                      }
                    }}
                    className="flex items-center space-x-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export Results as JSON</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Workflows;
