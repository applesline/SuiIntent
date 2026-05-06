import React from 'react';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
} from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';

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

interface ExecutionResultPanelProps {
  results: StepResult[];
  totalDuration: number;
  onClose?: () => void;
  onRetry?: () => void;
}

const ExecutionResultPanel: React.FC<ExecutionResultPanelProps> = ({
  results,
  totalDuration,
  onClose,
  onRetry,
}) => {
  const { t } = useLanguage();
  const [expandedSteps, setExpandedSteps] = React.useState<Set<number>>(new Set());
  const [showRawOutput, setShowRawOutput] = React.useState(false);

  const successfulSteps = results.filter(r => r.success).length;
  const failedSteps = results.filter(r => !r.success).length;
  const allSuccess = failedSteps === 0;

  const toggleStep = (index: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const copyResults = () => {
    const text = results.map((r, i) => 
      `[${r.success ? '✓' : '✗'}] Step ${i + 1}: ${r.toolName || r.name || 'Unknown'}${r.error ? ` - ${r.error}` : ''}`
    ).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const downloadResults = () => {
    const json = JSON.stringify({ results, totalDuration }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `execution-result-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden">
      {/* Header */}
      <div className={`p-4 ${allSuccess ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {allSuccess ? (
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
            ) : (
              <XCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
            )}
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">
                {allSuccess ? t('orchestration.executionComplete') : t('orchestration.executionFailed')}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {successfulSteps}/{results.length} {t('orchestration.stepsSucceeded')} · {totalDuration}ms
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={copyResults}
              className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title={t('orchestration.copyResults')}
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={downloadResults}
              className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title={t('orchestration.downloadResults')}
            >
              <Download className="w-4 h-4" />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <XCircle className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Step Results */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {results.map((result, index) => (
          <div key={index} className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50">
            {/* Step summary row */}
            <button
              onClick={() => toggleStep(index)}
              className="w-full flex items-center justify-between p-4 text-left"
            >
              <div className="flex items-center space-x-3 min-w-0">
                {result.success ? (
                  <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-medium text-gray-400 uppercase">
                      Step {index + 1}
                    </span>
                    {result.serverName && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                        {result.serverName}
                      </span>
                    )}
                  </div>
                  <p className="font-medium text-gray-900 dark:text-white truncate">
                    {result.toolName || result.name || t('orchestration.unknownStep')}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3 flex-shrink-0">
                {result.duration !== undefined && (
                  <span className="text-xs text-gray-500 flex items-center">
                    <Clock className="w-3 h-3 mr-1" />
                    {result.duration}ms
                  </span>
                )}
                {expandedSteps.has(index) ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}
              </div>
            </button>

            {/* Expanded details */}
            {expandedSteps.has(index) && (
              <div className="px-4 pb-4 space-y-3">
                {result.error && (
                  <div className="flex items-start space-x-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-900/50">
                    <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-red-700 dark:text-red-400">{t('orchestration.errorLabel')}</p>
                      <p className="text-sm text-red-600 dark:text-red-300">{result.error}</p>
                    </div>
                  </div>
                )}

                {result.output && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-500">{t('orchestration.outputLabel')}</span>
                      <button
                        onClick={() => setShowRawOutput(!showRawOutput)}
                        className="text-xs text-primary-500 hover:text-primary-600"
                      >
                        {showRawOutput ? t('orchestration.formatted') : t('orchestration.raw')}
                      </button>
                    </div>
                    <pre className="text-xs bg-gray-50 dark:bg-gray-900/50 p-3 rounded-lg overflow-x-auto border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 max-h-48 overflow-y-auto">
                      {showRawOutput ? JSON.stringify(result.output, null, 2) : result.output}
                    </pre>
                  </div>
                )}

                {result.result && (
                  <div>
                    <span className="text-xs font-medium text-gray-500 mb-1 block">{t('orchestration.resultLabel')}</span>
                    <pre className="text-xs bg-gray-50 dark:bg-gray-900/50 p-3 rounded-lg overflow-x-auto border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 max-h-48 overflow-y-auto">
                      {JSON.stringify(result.result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400">
            <span className="flex items-center">
              <CheckCircle className="w-4 h-4 text-green-500 mr-1" />
              {successfulSteps} {t('orchestration.succeeded')}
            </span>
            {failedSteps > 0 && (
              <span className="flex items-center">
                <XCircle className="w-4 h-4 text-red-500 mr-1" />
                {failedSteps} {t('orchestration.failed')}
              </span>
            )}
            <span className="flex items-center">
              <Clock className="w-4 h-4 mr-1" />
              {totalDuration}ms
            </span>
          </div>
          {onRetry && failedSteps > 0 && (
            <button
              onClick={onRetry}
              className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
            >
              {t('orchestration.retry')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExecutionResultPanel;
