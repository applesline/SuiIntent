import React from 'react';
import { 
  Server, 
  Wrench, 
  GitCommit, 
  Repeat, 
  Settings, 
  ChevronRight,
  MoreVertical,
  Trash2,
  FileText,
  Link2
} from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';
import type { WorkflowStep } from '../../types';

interface StepCardProps {
  step: WorkflowStep;
  index: number;
  onDelete?: (id: string) => void;
  onEdit?: (step: WorkflowStep) => void;
}

const StepCard: React.FC<StepCardProps> = ({ step, index, onDelete, onEdit }) => {
  const { t } = useLanguage();
  // Show execution status if available
  const executionResult = (step.parameters as any)?._executionResult;
  const executionStatus = executionResult?.success === true ? 'success' : 
    executionResult?.success === false ? 'error' : null;
  const executionDuration = executionResult?.duration;
  const executionError = executionResult?.error;
  const getIcon = () => {
    const stepType = step.type || 'tool';
    switch (stepType) {
      case 'server': return <Server className="w-5 h-5" />;
      case 'tool': return <Wrench className="w-5 h-5" />;
      case 'condition': return <GitCommit className="w-5 h-5" />;
      case 'loop': return <Repeat className="w-5 h-5" />;
      default: return <Settings className="w-5 h-5" />;
    }
  };

  const getBadgeColor = () => {
    const stepType = step.type || 'tool';
    switch (stepType) {
      case 'server': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'tool': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'condition': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400';
      case 'loop': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
    }
  };

  // Extract description from parameters._metadata if present
  const metadata = (step.parameters as any)?._metadata || {};
  const description = metadata.description || '';
  const paramDescription = metadata.parameters || '';
  
  // Filter out internal fields (_metadata, _executionResult) to show only actual tool parameters
  const getActualParameters = () => {
    if (!step.parameters || typeof step.parameters !== 'object') return {};
    const filtered: Record<string, any> = {};
    for (const [key, value] of Object.entries(step.parameters)) {
      if (!key.startsWith('_')) {
        filtered[key] = value;
      }
    }
    return filtered;
  };
  
  const actualParams = getActualParameters();
  const hasActualParams = Object.keys(actualParams).length > 0;

  return (
    <div className="card hover:shadow-md transition-all border-l-4 border-l-primary-500 relative group">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${getBadgeColor()}`}>
            {getIcon()}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('stepCard.stepNumber', { index: String(index + 1) })}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${getBadgeColor()}`}>
                {(step.type || 'tool').toUpperCase()}
              </span>
              {executionStatus && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  executionStatus === 'success' 
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                }`}>
                  {executionStatus === 'success' ? t('stepCard.success') : t('stepCard.failed')}
                </span>
              )}
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {step.toolName || step.serverName || t('stepCard.unnamedStep')}
            </h3>
            {/* Show description if available */}
            {description && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-md truncate">
                {description}
              </p>
            )}
            {/* Show parameter summary if available */}
            {paramDescription && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 max-w-md truncate italic">
                {paramDescription}
              </p>
            )}
          </div>
        </div>
        
        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={() => onEdit?.(step)}
            className="p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          <button 
            onClick={() => onDelete?.(step.id)}
            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 pl-11 space-y-2">
        {/* Server badge - more visual */}
        {step.serverName && (
          <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
            <Server className="w-3.5 h-3.5 mr-1.5 text-blue-500 flex-shrink-0" />
            <span className="font-medium mr-1.5">{t('stepCard.server')}</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
              {step.serverName}
            </span>
          </div>
        )}
        
        {/* Tool name - always show */}
        {step.toolName && (
          <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
            <Wrench className="w-3.5 h-3.5 mr-1.5 text-green-500 flex-shrink-0" />
            <span className="font-medium mr-1.5">{t('stepCard.tool')}</span>
            <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs font-mono">{step.toolName}</code>
          </div>
        )}
        
        {/* Actual tool parameters (filtered, no internal fields) */}
        {hasActualParams && (
          <div className="space-y-1">
            <div className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
              <FileText className="w-3.5 h-3.5 mr-1.5 text-gray-400" />
              {t('stepCard.parameters')}
            </div>
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-2 text-xs font-mono text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
              <table className="w-full table-fixed">
                <tbody>
                  {Object.entries(actualParams).map(([key, value]) => {
                    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
                    return (
                      <tr key={key} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                        <td className="py-1 pr-2 text-gray-500 dark:text-gray-500 whitespace-nowrap font-medium w-[30%] align-top">{key}</td>
                        <td className="py-1 text-gray-700 dark:text-gray-300 break-all align-top whitespace-pre-wrap">{valueStr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Execution error */}
        {executionError && (
          <div className="flex items-start text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
            <span className="font-medium mr-1">{t('stepCard.error')}</span>
            <span>{executionError}</span>
          </div>
        )}
      </div>

      {/* Dependencies visualization */}
      {(step as any).dependsOn && (step as any).dependsOn.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center text-xs text-gray-500">
            <Link2 className="w-3 h-3 mr-1" />
            <span className="font-medium mr-1">{t('stepCard.dependsOn')}</span>
            {(step as any).dependsOn.map((dep: string, i: number) => (
              <span key={dep} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200 dark:border-amber-800 ml-1">
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Next steps */}
      {(step as any).nextSteps && (step as any).nextSteps.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center text-xs text-gray-500">
          <ChevronRight className="w-3 h-3 mr-1" />
          {t('stepCard.next')} {(step as any).nextSteps.join(', ')}
        </div>
      )}
    </div>
  );
};

export default StepCard;

