import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import { 
  Eye, EyeOff, ClipboardPaste, X, RefreshCw, 
  Shield, Terminal, CheckCircle, AlertCircle,
  Loader2, LogIn, Copy, ChevronRight, ExternalLink
} from 'lucide-react';

export default function Login() {
  const { t } = useLanguage();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [errorType, setErrorType] = useState<'error' | 'warning' | 'success'>('error');
  const [loading, setLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [rememberToken, setRememberToken] = useState(false);
  const [daemonStatus, setDaemonStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [showHelp, setShowHelp] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 检查守护进程状态
  useEffect(() => {
    let mounted = true;
    const checkDaemon = async () => {
      try {
        const healthy = await apiService.healthCheck();
        if (mounted) {
          setDaemonStatus(healthy ? 'connected' : 'disconnected');
        }
      } catch {
        if (mounted) {
          setDaemonStatus('disconnected');
        }
      }
    };
    checkDaemon();
    return () => { mounted = true; };
  }, []);

  // 自动填充记住的令牌
  useEffect(() => {
    const savedToken = localStorage.getItem('remembered_token');
    if (savedToken) {
      setToken(savedToken);
      setRememberToken(true);
    }
  }, []);

  // 自动清除错误提示
  const showError = useCallback((message: string, type: 'error' | 'warning' | 'success' = 'error') => {
    setError(message);
    setErrorType(type);
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
    }
    if (type !== 'error') {
      errorTimerRef.current = setTimeout(() => {
        setError('');
      }, 5000);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 验证令牌格式
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      showError(t('login.error.invalidFormat'), 'warning');
      return;
    }

    setError('');
    setLoading(true);

    try {
      localStorage.setItem('auth_token', trimmedToken);
      
      try {
        await apiService.getServers();
        
        // 处理"记住令牌"
        if (rememberToken) {
          localStorage.setItem('remembered_token', trimmedToken);
        } else {
          localStorage.removeItem('remembered_token');
        }
        
        navigate('/');
      } catch (authError) {
        try {
          const isValid = await apiService.verifyToken();
          if (isValid) {
            showError(t('login.error.serverError'), 'warning');
          } else {
            showError(t('login.error.invalidToken'));
          }
        } catch (verifyError) {
          const isHealthy = await apiService.healthCheck();
          if (isHealthy) {
            showError(t('login.error.invalidToken'));
          } else {
            showError(t('login.error.cannotConnect'));
          }
        }
        localStorage.removeItem('auth_token');
      }
    } catch (err) {
      console.error('Login error:', err);
      showError(`${t('login.error.authenticationFailed')}: ${err instanceof Error ? err.message : String(err)}`);
      localStorage.removeItem('auth_token');
    } finally {
      setLoading(false);
    }
  };

  const handleGetToken = async () => {
    try {
      setError('');
      setLoading(true);
      const response = await fetch('http://localhost:9658/api/auth/token', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        mode: 'cors',
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.token) {
          setToken(data.token);
          showError(t('login.tokenObtained'), 'success');
        } else {
          showError(t('login.error.tokenNotFound'));
        }
      } else {
        const errorText = await response.text();
        showError(`${t('login.error.cannotGetToken')} (HTTP ${response.status})`);
      }
    } catch (err) {
      console.error('Error getting token:', err);
      showError(`${t('login.error.cannotConnect')}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setToken(text);
        showError(t('login.tokenPasted'), 'success');
      }
    } catch {
      showError(t('login.error.unknown'), 'warning');
    }
  };

  const handleClear = () => {
    setToken('');
    setError('');
    inputRef.current?.focus();
    showError(t('login.tokenCleared'), 'success');
  };

  const handleCopyCommand = () => {
    navigator.clipboard.writeText('pnpm --filter @intentorch/web dev');
    setCommandCopied(true);
    setTimeout(() => setCommandCopied(false), 2000);
  };

  const daemonStatusConfig = {
    checking: {
      color: 'text-yellow-500',
      bg: 'bg-yellow-50 dark:bg-yellow-900/20',
      border: 'border-yellow-200 dark:border-yellow-800',
      icon: Loader2,
      text: t('login.daemonStatus.checking'),
    },
    connected: {
      color: 'text-green-600',
      bg: 'bg-green-50 dark:bg-green-900/20',
      border: 'border-green-200 dark:border-green-800',
      icon: CheckCircle,
      text: t('login.daemonStatus.connected'),
    },
    disconnected: {
      color: 'text-gray-500',
      bg: 'bg-gray-50 dark:bg-gray-800',
      border: 'border-gray-200 dark:border-gray-700',
      icon: AlertCircle,
      text: t('login.daemonStatus.disconnected'),
    },
  };

  const status = daemonStatusConfig[daemonStatus];
  const StatusIcon = status.icon;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex flex-col">
      {/* 顶部语言切换 */}
      <div className="absolute top-4 right-4 z-10">
        <LanguageSwitcher />
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col justify-center py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          {/* Logo 和品牌区 */}
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center w-20 h-20 rounded-full overflow-hidden bg-gradient-to-br from-blue-500/10 to-indigo-500/10 dark:from-blue-500/20 dark:to-indigo-500/20 ring-1 ring-blue-200/30 dark:ring-blue-800/30 shadow-lg shadow-blue-200/30 dark:shadow-blue-900/20">
              <img src="/logo.jpg" alt={t('app.name')} className="w-full h-full object-cover" />
            </div>
            <h2 className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">
              {t('login.title')}
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('login.tagline')}
            </p>
          </div>

          {/* 守护进程状态指示器 */}
          <div className={`mt-4 flex items-center justify-center space-x-2 px-3 py-1.5 rounded-full ${status.bg} ${status.border} border`}>
            <StatusIcon className={`w-4 h-4 ${status.color} ${daemonStatus === 'checking' ? 'animate-spin' : ''}`} />
            <span className={`text-xs font-medium ${status.color}`}>{status.text}</span>
          </div>
        </div>

        <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white dark:bg-gray-800 py-8 px-4 sm:px-8 shadow-xl shadow-gray-200/50 dark:shadow-black/20 sm:rounded-2xl border border-gray-100 dark:border-gray-700">
            <form className="space-y-5" onSubmit={handleSubmit}>
              {/* 令牌输入区域 */}
              <div>
                <label htmlFor="token" className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {t('login.authenticationToken')}
                </label>
                <div className="mt-1.5 relative">
                  <input
                    ref={inputRef}
                    id="token"
                    name="token"
                    type={showToken ? 'text' : 'password'}
                    autoComplete="off"
                    required
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      if (error) setError('');
                    }}
                    className="appearance-none block w-full px-3 py-2.5 pr-20 border border-gray-300 dark:border-gray-600 rounded-xl shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white sm:text-sm transition-all"
                    placeholder={t('login.tokenPlaceholder')}
                    aria-label={t('login.tokenInputLabel')}
                  />
                  
                  {/* 输入框操作按钮组 */}
                  <div className="absolute inset-y-0 right-0 flex items-center pr-2 space-x-1">
                    {/* 显示/隐藏令牌 */}
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                      title={showToken ? t('login.hideToken') : t('login.showToken')}
                      tabIndex={-1}
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    
                    {/* 粘贴 */}
                    <button
                      type="button"
                      onClick={handlePaste}
                      className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                      title={t('login.pasteFromClipboard')}
                      tabIndex={-1}
                    >
                      <ClipboardPaste className="w-4 h-4" />
                    </button>
                    
                    {/* 清空 */}
                    {token && (
                      <button
                        type="button"
                        onClick={handleClear}
                        className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title={t('login.clearInput')}
                        tabIndex={-1}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                
                {/* 令牌提示信息 */}
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 flex items-start space-x-1">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>{t('login.tokenHelp')}</span>
                </p>
              </div>

              {/* 记住令牌复选框 */}
              <div className="flex items-center">
                <input
                  id="remember-token"
                  name="remember-token"
                  type="checkbox"
                  checked={rememberToken}
                  onChange={(e) => setRememberToken(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 rounded"
                />
                <label htmlFor="remember-token" className="ml-2 block text-sm text-gray-600 dark:text-gray-400">
                  {t('login.rememberToken')}
                  <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">({t('login.rememberTokenHint')})</span>
                </label>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className={`rounded-xl p-4 ${
                  errorType === 'error' 
                    ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' 
                    : errorType === 'warning'
                    ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'
                    : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                }`}>
                  <div className="flex items-start">
                    <div className={`flex-shrink-0 ${
                      errorType === 'error' ? 'text-red-500' : errorType === 'warning' ? 'text-yellow-500' : 'text-green-500'
                    }`}>
                      {errorType === 'success' ? (
                        <CheckCircle className="w-5 h-5" />
                      ) : (
                        <AlertCircle className="w-5 h-5" />
                      )}
                    </div>
                    <div className="ml-3 flex-1">
                      <p className={`text-sm font-medium ${
                        errorType === 'error' 
                          ? 'text-red-800 dark:text-red-200' 
                          : errorType === 'warning'
                          ? 'text-yellow-800 dark:text-yellow-200'
                          : 'text-green-800 dark:text-green-200'
                      }`}>
                        {error}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setError('')}
                      className={`ml-3 flex-shrink-0 ${
                        errorType === 'error' 
                          ? 'text-red-500 hover:text-red-600' 
                          : errorType === 'warning'
                          ? 'text-yellow-500 hover:text-yellow-600'
                          : 'text-green-500 hover:text-green-600'
                      }`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={loading || !token.trim()}
                  className="w-full flex items-center justify-center py-2.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t('login.loggingIn')}
                    </>
                  ) : (
                    <>
                      <LogIn className="w-4 h-4 mr-2" />
                      {t('login.login')}
                    </>
                  )}
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200 dark:border-gray-700" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-2 bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500">
                      {t('login.or')}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGetToken}
                  disabled={loading}
                  className="w-full flex items-center justify-center py-2.5 px-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl shadow-sm text-sm font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  {t('login.getTokenFromDaemon')}
                </button>
              </div>
            </form>

            {/* 帮助区域 - 只保留第一点 */}
            <div className="mt-6">
              <button
                onClick={() => setShowHelp(!showHelp)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <Terminal className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('login.howToGetToken')}
                  </span>
                </div>
                <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showHelp ? 'rotate-90' : ''}`} />
              </button>

              {showHelp && (
                <div className="mt-3 px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700 animate-fadeIn">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    {t('login.step1')}
                  </p>
                  <div className="relative group">
                    <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 p-3 rounded-lg text-xs font-mono overflow-x-auto">
                      <code>pnpm --filter @intentorch/web dev</code>
                    </pre>
                    <button
                      onClick={handleCopyCommand}
                      className="absolute top-2 right-2 p-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                      title={t('login.tokenInputHelpAction')}
                    >
                      {commandCopied ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  {commandCopied && (
                    <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                      {t('login.tokenInputHelpCopied')}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 安全提示 */}
            <div className="mt-4 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30">
              <div className="flex items-start space-x-2">
                <Shield className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                    {t('login.tokenSecurityTitle')}
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                    {t('login.tokenSecurityDesc')}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 底部链接 */}
          <div className="mt-6 text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {t('login.needHelp')}{' '}
              <a 
                href="https://github.com/MCPilotX/IntentOrch" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 inline-flex items-center"
              >
                {t('login.viewDocs')}
                <ExternalLink className="w-3 h-3 ml-0.5" />
              </a>
              {' / '}
              <a 
                href="mailto:applesline@163.com"
                className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {t('login.contactSupport')}
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
