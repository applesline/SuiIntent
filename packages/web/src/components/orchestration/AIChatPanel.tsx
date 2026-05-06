import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, Sparkles, Loader2 } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';
import MessageContentRenderer from '../common/MessageContentRenderer';
import InteractiveMessageRenderer from './InteractiveMessageRenderer';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    isInteractive?: boolean;
    guidance?: any;
    requiresResponse?: boolean;
    parameterName?: string;
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

interface AIChatPanelProps {
  onSendMessage: (content: string) => void;
  messages: Message[];
  isAnalyzing: boolean;
  statusMessage?: string;
}

const AIChatPanel: React.FC<AIChatPanelProps> = ({ onSendMessage, messages, isAnalyzing, statusMessage }) => {
  const { t } = useLanguage();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAnalyzing]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isAnalyzing) return;
    
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-primary-50 dark:bg-primary-900/10">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-primary-500 rounded-lg shadow-sm">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white">{t('orchestration.aiAssistant')}</h2>
            <div className="flex items-center space-x-1.5">
              <span className="flex h-2 w-2 rounded-full bg-green-500"></span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{t('orchestration.subtitle')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-10 opacity-50">
            <Sparkles className="w-12 h-12 mx-auto mb-3 text-primary-300" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('orchestration.chatPlaceholder')}
            </p>
          </div>
        )}

        {messages.map((message) => {
          // Check if this is an interactive message
          const isInteractive = message.metadata?.isInteractive && message.metadata?.guidance;
          
          return (
            <div 
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {isInteractive ? (
                // Interactive message
                <div className="w-full max-w-[90%]">
                  <InteractiveMessageRenderer 
                    guidance={message.metadata.guidance}
                    onResponse={(response) => {
                      // Send interactive response as structured message
                      onSendMessage(JSON.stringify(response));
                    }}
                  />
                </div>
              ) : (
                // Regular message
                <div className={`flex max-w-[85%] ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start gap-2`}>
                  <div className={`p-2 rounded-lg flex-shrink-0 ${
                    message.role === 'user' 
                      ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400' 
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {message.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>
                  <div className={`p-3 rounded-2xl text-sm ${
                    message.role === 'user'
                      ? 'bg-primary-500 text-white rounded-tr-none'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-tl-none'
                  }`}>
                    <MessageContentRenderer content={message.content} role={message.role} />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {isAnalyzing && (
          <div className="flex justify-start">
            <div className="flex items-start gap-2">
              <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 flex-shrink-0">
                <Bot className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </div>
              <div className="p-3 rounded-2xl bg-gray-100 dark:bg-gray-700 rounded-tl-none flex items-center space-x-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {statusMessage || t('orchestration.analyzing')}
                </span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
        <form onSubmit={handleSubmit} className="relative group">
          <textarea
            className="w-full pl-4 pr-14 py-3.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200 shadow-sm hover:border-gray-300 dark:hover:border-gray-500 resize-none text-sm min-h-[42px] max-h-42"
            placeholder={t('orchestration.inputPlaceholder')}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || isAnalyzing}
            className="absolute right-2.5 bottom-3.5 p-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 active:scale-95 transition-all disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-primary-500/20"
            title={t('orchestration.sendButton')}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
        <div className="mt-2 flex items-center justify-center space-x-2 opacity-40">
          <Sparkles className="w-2.5 h-2.5 text-primary-500" />
          <p className="text-[10px] font-medium tracking-wider uppercase text-gray-500 dark:text-gray-400">
            {t('orchestration.poweredBy')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default AIChatPanel;
