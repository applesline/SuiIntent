import React, { useState } from 'react';
import { X, Save, Server, Wrench, FileText } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';
import type { WorkflowStep } from '../../types';

interface StepEditorModalProps {
  step: WorkflowStep;
  index: number;
  onSave: (step: WorkflowStep) => void;
  onClose: () => void;
}

const StepEditorModal: React.FC<StepEditorModalProps> = ({ step, index, onSave, onClose }) => {
  const { t } = useLanguage();
  const [editedStep, setEditedStep] = useState<WorkflowStep>({ ...step });
  const [parametersText, setParametersText] = useState(
    JSON.stringify(step.parameters || {}, null, 2)
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleParameterChange = (value: string) => {
    setParametersText(value);
    try {
      const parsed = JSON.parse(value);
      setEditedStep(prev => ({ ...prev, parameters: parsed }));
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof SyntaxError ? e.message : 'Invalid JSON');
    }
  };

  const handleSave = () => {
    if (jsonError) return;
    onSave(editedStep);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="font-bold text-gray-900 dark:text-white">
              {t('orchestration.editStep')} #{index + 1}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {step.toolName || step.serverName || t('stepEditor.unnamedStep')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(80vh-140px)]">
          {/* Server Name */}
          <div>
            <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              <Server className="w-4 h-4 mr-1.5 text-blue-500" />
              {t('orchestration.serverName')}
            </label>
            <input
              type="text"
              value={editedStep.serverName || ''}
              onChange={(e) => setEditedStep(prev => ({ ...prev, serverName: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder={t('stepEditor.serverPlaceholder')}
            />
          </div>

          {/* Tool Name */}
          <div>
            <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              <Wrench className="w-4 h-4 mr-1.5 text-green-500" />
              {t('orchestration.toolName')}
            </label>
            <input
              type="text"
              value={editedStep.toolName || ''}
              onChange={(e) => setEditedStep(prev => ({ ...prev, toolName: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder={t('stepEditor.toolPlaceholder')}
            />
          </div>

          {/* Step Type */}
          <div>
            <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t('stepEditor.type')}
            </label>
            <select
              value={editedStep.type || 'tool'}
              onChange={(e) => setEditedStep(prev => ({ ...prev, type: e.target.value as WorkflowStep['type'] }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="tool">{t('stepEditor.typeTool')}</option>
              <option value="server">{t('stepEditor.typeServer')}</option>
              <option value="condition">{t('stepEditor.typeCondition')}</option>
              <option value="loop">{t('stepEditor.typeLoop')}</option>
            </select>
          </div>

          {/* Parameters (JSON editor) */}
          <div>
            <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              <FileText className="w-4 h-4 mr-1.5 text-gray-400" />
              {t('orchestration.parameters')}
            </label>
            <textarea
              value={parametersText}
              onChange={(e) => handleParameterChange(e.target.value)}
              rows={8}
              className={`w-full px-3 py-2 text-xs font-mono border rounded-lg bg-gray-50 dark:bg-gray-900 focus:ring-2 focus:border-transparent resize-none ${
                jsonError 
                  ? 'border-red-300 dark:border-red-700 focus:ring-red-500' 
                  : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'
              }`}
              spellCheck={false}
            />
            {jsonError && (
              <p className="mt-1 text-xs text-red-500">{jsonError}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!!jsonError}
            className="flex items-center space-x-2 px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>{t('common.save')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default StepEditorModal;
