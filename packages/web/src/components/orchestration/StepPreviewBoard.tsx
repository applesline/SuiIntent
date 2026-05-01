import React from 'react';
import { 
  Rocket, 
  Trash2, 
  Plus, 
  HelpCircle, 
  Globe, 
  Activity,
  CheckCircle,
  AlertCircle,
  Play,
  Save,
  ChevronDown,
  Info
} from 'lucide-react';
import StepCard from './StepCard';
import { useLanguage } from '../../contexts/LanguageContext';
import type { WorkflowStep } from '../../types';

interface StepPreviewBoardProps {
  steps: WorkflowStep[];
  status: 'idle' | 'success' | 'capability_missing' | 'partial' | 'error';
  onPublish?: () => void;
  onClear: () => void;
  onDeleteStep: (id: string) => void;
  onEditStep?: (step: WorkflowStep) => void;
  onAddStep?: () => void;
  actionSelection?: 'execute' | 'save';
  onActionChange?: (action: 'execute' | 'save') => void;
  onActionExecute?: () => void;
  isExecuting?: boolean;
}

const StepPreviewBoard: React.FC<StepPreviewBoardProps> = ({ 
  steps, 
  status, 
  onClear, 
  onDeleteStep,
  onEditStep,
  onAddStep,
  actionSelection = 'execute',
  onActionChange,
  onActionExecute,
  isExecuting = false
}) => {
  const { t, language } = useLanguage();
  const [showActionDropdown, setShowActionDropdown] = React.useState(false);
  
  const actionOptions = [
    { 
      value: 'execute' as const, 
      label: t('orchestration.executeNow'), 
      icon: Play, 
      description: t('orchestration.executeNowDesc'), 
      color: 'from-primary-500 to-primary-600',
      iconColor: 'text-primary-600'
    },
    { 
      value: 'save' as const, 
      label: t('orchestration.saveOnly'), 
      icon: Save, 
      description: t('orchestration.saveOnlyDesc'), 
      color: 'from-green-500 to-green-600',
      iconColor: 'text-green-600'
    },
  ];
  
  const selectedAction = actionOptions.find(opt => opt.value === actionSelection) || actionOptions[0];
  
  const handleActionSelect = (action: 'execute' | 'save') => {
    if (onActionChange) {
      onActionChange(action);
    }
    setShowActionDropdown(false);
  };
  
  const handleExecute = () => {
    if (onActionExecute) {
      onActionExecute();
    }
  };
  
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900/50">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-between shadow-sm">
        <div>
          <h2 className="font-bold text-gray-900 dark:text-white">{t('orchestration.title')}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('orchestration.stepsGenerated', { count: steps.length })}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={onClear}
            disabled={steps.length === 0}
            className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('orchestration.clearAllSteps')}
          >
            <Trash2 className="w-5 h-5" />
          </button>
          
          {/* Action Dropdown */}
          {steps.length > 0 && (
            <div className="relative">
              <div className="flex items-center space-x-2">
                {/* Combined dropdown selector and Go button */}
                <div className="flex items-center flex-shrink-0">
                  {/* Dropdown button */}
                  <button
                    onClick={() => setShowActionDropdown(!showActionDropdown)}
                    disabled={steps.length === 0}
                    className="flex items-center space-x-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-l-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-w-[160px] justify-between flex-shrink-0"
                    title={t('orchestration.selectAction')}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <selectedAction.icon className={`w-4 h-4 ${selectedAction.iconColor} flex-shrink-0`} />
                      <span className="font-medium text-gray-900 dark:text-white truncate">{selectedAction.label}</span>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showActionDropdown ? 'rotate-180' : ''} flex-shrink-0`} />
                  </button>
                  
                  {/* Execute button */}
                  <button
                    onClick={handleExecute}
                    disabled={isExecuting || steps.length === 0}
                    className={`flex items-center space-x-2 px-4 py-2 bg-gradient-to-r ${selectedAction.color} text-white rounded-r-lg hover:opacity-90 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed border-l-0 flex-shrink-0`}
                  >
                    {isExecuting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0"></div>
                        <span className="font-medium text-white flex-shrink-0">{t('orchestration.executing')}</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 text-white flex-shrink-0" />
                        <span className="font-medium text-white flex-shrink-0">{t('orchestration.go')}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
              
              {/* Dropdown Menu */}
              {showActionDropdown && (
                <>
                  <div 
                    className="fixed inset-0 z-40"
                    onClick={() => setShowActionDropdown(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
                    <div className="p-3 border-b border-gray-100 dark:border-gray-700">
                      <div className="flex items-center space-x-2">
                        <Info className="w-4 h-4 text-gray-400" />
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('orchestration.chooseAction')}</span>
                      </div>
                    </div>
                    
                    <div className="py-2">
                      {actionOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => handleActionSelect(option.value)}
                          className={`w-full flex items-start space-x-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${actionSelection === option.value ? 'bg-gray-50 dark:bg-gray-700/50' : ''}`}
                        >
                          <div className={`p-2 rounded-lg ${actionSelection === option.value ? 'bg-white dark:bg-gray-600 shadow-sm' : 'bg-gray-100 dark:bg-gray-700'}`}>
                            <option.icon className={`w-4 h-4 ${actionSelection === option.value ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`} />
                          </div>
                          <div className="flex-1 text-left">
                            <div className="font-medium text-gray-900 dark:text-white">{option.label}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{option.description}</div>
                          </div>
                          {actionSelection === option.value && (
                            <div className="w-2 h-2 rounded-full bg-primary-500"></div>
                          )}
                        </button>
                      ))}
                    </div>
                    
                    <div className="p-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {t('orchestration.actionTip')}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {steps.length > 0 ? (
          <div className="relative">
            {/* Connection Line */}
            <div className="absolute left-[22px] top-6 bottom-6 w-0.5 bg-gray-200 dark:bg-gray-700 -z-10"></div>
            
            <div className="space-y-6">
              {steps.map((step, index) => (
                <StepCard 
                  key={step.id} 
                  step={step} 
                  index={index} 
                  onDelete={onDeleteStep}
                  onEdit={onEditStep}
                />
              ))}
              
              <button
                onClick={onAddStep}
                className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl flex items-center justify-center space-x-2 text-gray-500 hover:text-primary-500 hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/10 transition-all group"
              >
                <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                <span className="font-medium">{t('orchestration.addStepManually')}</span>
              </button>
            </div>
          </div>
        ) : status === 'capability_missing' ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 border-2 border-yellow-200 dark:border-yellow-900/50 shadow-xl max-w-lg mx-auto mt-10">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center mb-6">
                <HelpCircle className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">{t('orchestration.capabilityMissing')}</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-8 leading-relaxed">
                {t('orchestration.capabilityMissingDesc')}
              </p>
              
              <div className="w-full space-y-3">
                <a 
                  href={language === 'zh' ? 'https://gitee.com/MCPilotX/mcp-server-hub' : 'https://github.com/MCPilotX/mcp-server-hub'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center space-x-3 w-full py-3 bg-gray-900 text-white rounded-xl hover:bg-black transition-colors"
                >
                  <Globe className="w-5 h-5" />
                  <span>{t('orchestration.submitRequest')}</span>
                  <Activity className="w-4 h-4" />
                </a>
                <button className="flex items-center justify-center space-x-3 w-full py-3 border-2 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <CheckCircle className="w-5 h-5" />
                  <span>{t('orchestration.contactSupport')}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4 opacity-50">
            <div className="p-6 bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-800">
              <Rocket className="w-16 h-16" />
            </div>
            <div className="text-center">
              <h3 className="font-bold text-gray-600 dark:text-gray-400">{t('orchestration.noDraft')}</h3>
              <p className="text-sm">{t('orchestration.subtitle')}</p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-xl border border-red-100 dark:border-red-900/50">
            <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0" />
            <p className="text-sm">{t('orchestration.failedToGenerate')}</p>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center justify-center text-[10px] text-gray-400 uppercase tracking-widest">
        {t('orchestration.draftMode')}
      </div>
    </div>
  );
};

export default StepPreviewBoard;
