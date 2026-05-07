/**
 * AI 配置弹窗
 *
 * 允许用户配置 AI 提供商、API Key 和模型。
 * 配置存储在 localStorage，前端调用 daemon API 时传递。
 * daemon 用完即弃，不持久化 apiKey。
 */

import React, { useState, useEffect } from 'react';
import { X, Key, Save, Eye, EyeOff, Check, AlertCircle } from 'lucide-react';
import { getAIConfig, saveAIConfig, clearAIConfig, type AIConfig } from '../../hooks/useSuiIntent';
import { useLanguage } from '../../contexts/LanguageContext';

interface AIConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { value: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'] },
  { value: 'anthropic', label: 'Anthropic', models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'] },
  { value: 'siliconflow', label: 'SiliconFlow', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'] },
];

const AIConfigModal: React.FC<AIConfigModalProps> = ({ isOpen, onClose }) => {
  const { t } = useLanguage();
  const [config, setConfig] = useState<AIConfig>({
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // 加载已有配置
  useEffect(() => {
    if (isOpen) {
      const existing = getAIConfig();
      if (existing) {
        setConfig(existing);
      }
      setSaved(false);
      setError('');
    }
  }, [isOpen]);

  const handleSave = () => {
    if (!config.apiKey.trim()) {
      setError(t('aiConfig.error.apiKeyRequired'));
      return;
    }
    if (!config.provider) {
      setError(t('aiConfig.error.providerRequired'));
      return;
    }

    saveAIConfig(config);
    setSaved(true);
    setError('');

    // 1.5 秒后关闭
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  const handleClear = () => {
    clearAIConfig();
    setConfig({ provider: 'deepseek', apiKey: '', model: 'deepseek-chat' });
    setSaved(false);
    setError('');
  };

  const handleProviderChange = (provider: string) => {
    const providerConfig = PROVIDERS.find(p => p.value === provider);
    setConfig({
      ...config,
      provider,
      model: providerConfig?.models[0] || '',
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-xl">
              <Key className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">{t('aiConfig.title')}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('aiConfig.description')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t('aiConfig.provider')}
            </label>
            <select
              value={config.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full px-3 py-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t('aiConfig.model')}
            </label>
            <select
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              className="w-full px-3 py-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
            >
              {PROVIDERS.find(p => p.value === config.provider)?.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t('aiConfig.apiKey')}
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={config.apiKey}
                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                placeholder={t('aiConfig.apiKeyPlaceholder')}
                className="w-full px-3 py-2.5 pr-10 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-gray-400">
              {t('aiConfig.apiKeyHint')}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center space-x-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
            </div>
          )}

          {/* Success */}
          {saved && (
            <div className="flex items-center space-x-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
              <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span className="text-sm text-green-600 dark:text-green-400">{t('aiConfig.saveSuccess')}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
          <button
            onClick={handleClear}
            className="px-4 py-2 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
          >
            {t('aiConfig.clearConfig')}
          </button>
          <button
            onClick={handleSave}
            className="flex items-center space-x-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 active:scale-95 transition-all shadow-md shadow-primary-500/20"
          >
            <Save className="w-4 h-4" />
            <span className="text-sm font-medium">{t('aiConfig.saveConfig')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIConfigModal;
