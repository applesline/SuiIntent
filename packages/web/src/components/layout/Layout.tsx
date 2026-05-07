import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { 
  Sparkles,
  Settings,
  Workflow,
} from 'lucide-react';
import { ConnectButton } from '@mysten/dapp-kit';
import { useLanguage } from '../../contexts/LanguageContext';
import LanguageSwitcher from '../common/LanguageSwitcher';
import AIConfigModal from '../orchestration/AIConfigModal';
import { getAIConfig } from '../../hooks/useSuiIntent';

const Layout: React.FC = () => {
  const [showAIConfig, setShowAIConfig] = useState(false);
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = [
    { name: t('orchestration.title'), href: '/', icon: Sparkles },
    { name: t('layout.workflowOrchestration'), href: '/workflows', icon: Workflow },
  ];

  const isActive = (href: string) => {
    if (href === '/') return location.pathname === '/';
    return location.pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between h-16 px-4 lg:px-6">
          {/* Logo + Tabs */}
          <div className="flex items-center space-x-6">
            {/* Logo */}
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center">
                <img 
                  src="/logo.jpg" 
                  alt={t('app.name')}
                  className="w-full h-full object-cover"
                />
              </div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white hidden sm:block">SuiIntent</h1>
            </div>

            {/* Tab Navigation */}
            <nav className="flex items-center space-x-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = isActive(tab.href);
                return (
                  <button
                    key={tab.href}
                    onClick={() => navigate(tab.href)}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      active
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.name}</span>
                  </button>
                );
              })}
            </nav>
          </div>
          
          {/* Right side actions */}
          <div className="flex items-center space-x-3">
            {/* AI 配置按钮 */}
            <button
              onClick={() => setShowAIConfig(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-primary-300 dark:hover:border-primary-600 transition-all text-xs"
              title={t('aiConfig.layoutButtonTitle')}
            >
              <Settings className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-gray-600 dark:text-gray-300 font-medium">{t('aiConfig.layoutButton')}</span>
              {getAIConfig()?.apiKey ? (
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
              )}
            </button>
            <LanguageSwitcher />
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 p-4 lg:p-6">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-700 px-4 lg:px-6 py-4">
        <div className="flex flex-col md:flex-row justify-between items-center text-sm text-gray-500 dark:text-gray-400">
          <div className="flex flex-col md:flex-row items-center space-y-1 md:space-y-0 md:space-x-4 mb-2 md:mb-0">
            <div>
              {t('layout.footer.copyright', { year: new Date().getFullYear() })}
            </div>
            <div className="hidden md:block">•</div>
            <div>
              <span>{t('layout.footer.version')}: v0.8.0</span>
            </div>
          </div>
        </div>
      </footer>

      {/* AI 配置弹窗 */}
      <AIConfigModal
        isOpen={showAIConfig}
        onClose={() => setShowAIConfig(false)}
      />
    </div>
  );
};

export default Layout;
