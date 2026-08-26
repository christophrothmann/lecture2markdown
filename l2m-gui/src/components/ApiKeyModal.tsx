import React, { useState, useEffect } from 'react';
import { KeyRound, ExternalLink, CheckCircle2, AlertCircle, Loader2, X, Trash2, Database, Sparkles, Globe } from 'lucide-react';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';

export type ProviderType = 'openai' | 'google' | 'anthropic' | 'mistral';

interface ProviderConfig {
  id: ProviderType;
  name: string;
  keyPlaceholder: string;
  portalUrl: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    keyPlaceholder: 'sk-proj-...',
    portalUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    keyPlaceholder: 'AIzaSy...',
    portalUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    keyPlaceholder: 'sk-ant-api03-...',
    portalUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    keyPlaceholder: 'mis_...',
    portalUrl: 'https://console.mistral.ai/api-keys/',
  },
];

interface ApiKeyModalProps {
  isOpen: boolean;
  activeProvider: ProviderType;
  providerKeys: Record<string, string>;
  onSelectProvider: (provider: ProviderType) => void;
  onSaveKey: (provider: ProviderType, key: string) => void;
  onClose: () => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  activeProvider,
  providerKeys,
  onSelectProvider,
  onSaveKey,
  onClose,
}) => {
  const { t, i18n } = useTranslation();
  const [selectedTab, setSelectedTab] = useState<ProviderType>(activeProvider);
  const [currentInput, setCurrentInput] = useState<string>('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [cacheStats, setCacheStats] = useState<{ count: number; size_kb: number }>({ count: 0, size_kb: 0 });
  const [cacheClearing, setCacheClearing] = useState(false);

  const fetchCacheStats = async () => {
    try {
      const stats = await invoke<{ count: number; size_kb: number }>('get_slide_cache_stats_native');
      setCacheStats(stats);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    setSelectedTab(activeProvider);
  }, [activeProvider, isOpen]);

  // Sync input when tab changes or modal opens
  useEffect(() => {
    setCurrentInput(providerKeys[selectedTab] || '');
    setTestResult(null);
    if (isOpen) {
      fetchCacheStats();
    }
  }, [selectedTab, providerKeys, isOpen]);

  if (!isOpen) return null;

  const currentProviderInfo = PROVIDERS.find((p) => p.id === selectedTab)!;

  const handleTestKey = async () => {
    if (!currentInput.trim()) return;

    setTesting(true);
    setTestResult(null);

    try {
      const result = await invoke<{ success: boolean; message: string; model_used: string }>(
        'test_api_key_native',
        {
          provider: selectedTab,
          apiKey: currentInput.trim(),
        }
      );

      setTestResult({
        success: result.success,
        message: result.message,
      });

      if (result.success) {
        onSaveKey(selectedTab, currentInput.trim());
      }
    } catch (e: any) {
      setTestResult({
        success: false,
        message: `Fehler: ${e?.toString() || 'Unbekannter Fehler'}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveAndProceed = () => {
    if (currentInput.trim()) {
      onSaveKey(selectedTab, currentInput.trim());
    }
    onSelectProvider(selectedTab);
    onClose();
  };

  const handleOpenPortal = async () => {
    try {
      await openUrl(currentProviderInfo.portalUrl);
    } catch (e) {
      console.error('Konnte URL nicht öffnen:', e);
    }
  };

  const handleClearSlideCache = async () => {
    if (!window.confirm(t('settings.cache_clear_confirm'))) {
      return;
    }

    setCacheClearing(true);
    try {
      await invoke('clear_slide_cache_native');
      await fetchCacheStats();
    } catch (e) {
      console.error('Fehler beim Leeren des Caches:', e);
    } finally {
      setCacheClearing(false);
    }
  };

  const hasAnyKey = Object.values(providerKeys).some((k) => Boolean(k && k.trim()));

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="glass-card w-full max-w-lg max-h-[85vh] rounded-2xl border border-border shadow-2xl flex flex-col relative overflow-hidden my-auto">
        {/* Fixed Modal Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0 bg-surface/40">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-accent/20 text-accent rounded-xl">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                {t('settings.title')} <Sparkles className="w-4 h-4 text-amber-400" />
              </h2>
              <p className="text-xs text-slate-400">{t('settings.subtitle')}</p>
            </div>
          </div>

          {hasAnyKey && (
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 transition p-1.5 hover:bg-surface rounded-lg cursor-pointer ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Scrollable Content Body (Internally padded with scrollbar nested inside card) */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 pr-4 mr-1">
          {/* Language Selector */}
          <div className="p-3 bg-surface/50 border border-border/80 rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <Globe className="w-4 h-4 text-accent" />
              <span className="text-xs font-semibold text-slate-200">{t('settings.language_label')}</span>
            </div>
            <div className="flex bg-background p-1 rounded-lg border border-border">
              <button
                type="button"
                onClick={() => i18n.changeLanguage('de')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                  i18n.language.startsWith('de')
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🇩🇪 {t('settings.lang_de')}
              </button>
              <button
                type="button"
                onClick={() => i18n.changeLanguage('en')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                  i18n.language.startsWith('en')
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🇬🇧 {t('settings.lang_en')}
              </button>
            </div>
          </div>

          {/* Provider Tabs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-surface p-1.5 rounded-xl border border-border">
            {PROVIDERS.map((provider) => {
              const hasKey = Boolean(providerKeys[provider.id]);
              const isSelected = selectedTab === provider.id;

              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => setSelectedTab(provider.id)}
                  className={`py-2 px-2 rounded-lg text-xs font-semibold flex flex-col items-center gap-1 transition cursor-pointer relative ${
                    isSelected
                      ? 'bg-accent text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <span>{provider.name}</span>
                    {provider.id === 'mistral' && (
                      <span className="text-[8px] px-1 py-0.2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded font-mono font-bold">
                        FREE
                      </span>
                    )}
                  </div>
                  {hasKey && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSelected ? 'bg-white' : 'bg-emerald-400'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Free-Tier Info Callout for Mistral */}
          {selectedTab === 'mistral' && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-start space-x-2.5">
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-[11px] text-emerald-200/90 leading-relaxed">
                <span className="font-semibold text-emerald-300 block mb-0.5">{t('settings.mistral_tip_title')}</span>
                <span dangerouslySetInnerHTML={{ __html: t('settings.mistral_tip_body') }} />
              </div>
            </div>
          )}

          {/* Selected Provider Card */}
          <div className="p-3.5 bg-surface/60 border border-border rounded-xl space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-200">{currentProviderInfo.name}</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 bg-accent/20 text-accent rounded-md">
                {t(`settings.providers.${currentProviderInfo.id}.badge`)}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {t(`settings.providers.${currentProviderInfo.id}.description`)}
            </p>
          </div>

          {/* Key Input Field */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                {t('settings.key_input_label', { provider: currentProviderInfo.name })}
              </label>
              <input
                type="password"
                value={currentInput}
                onChange={(e) => {
                  setCurrentInput(e.target.value);
                  setTestResult(null);
                }}
                placeholder={currentProviderInfo.keyPlaceholder}
                className="w-full px-4 py-3 bg-background border border-border rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent text-sm transition"
              />
            </div>

            <div className="flex justify-between items-center text-xs">
              <button
                type="button"
                onClick={handleOpenPortal}
                className="inline-flex items-center text-accent hover:underline gap-1 transition cursor-pointer font-medium bg-transparent border-0 p-0"
              >
                {t(`settings.providers.${currentProviderInfo.id}.portalLabel`)} <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-xl flex items-center space-x-2 text-xs font-medium ${
                  testResult.success
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Folien-Cache Management Card */}
          <div className="p-3 bg-surface/50 border border-border/80 rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <Database className="w-4 h-4 text-slate-400" />
              <div>
                <span className="text-xs font-semibold text-slate-200 block">{t('settings.cache_title')}</span>
                <span className="text-[11px] text-slate-400">
                  {t(cacheStats.count === 1 ? 'settings.cache_stats' : 'settings.cache_stats_plural', {
                    count: cacheStats.count,
                    size: cacheStats.size_kb,
                  })}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClearSlideCache}
              disabled={cacheClearing || cacheStats.count === 0}
              className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" /> {cacheClearing ? t('settings.cache_clearing') : t('settings.cache_clear')}
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={handleTestKey}
              disabled={testing || !currentInput.trim()}
              className="flex-1 py-3 px-4 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl font-medium text-sm transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : t('settings.test_key')}
            </button>

            <button
              type="button"
              onClick={handleSaveAndProceed}
              disabled={!currentInput.trim() && !hasAnyKey}
              className="flex-1 py-3 px-4 bg-accent hover:bg-accent-hover text-white rounded-xl font-medium text-sm transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-lg shadow-accent/20"
            >
              {t('settings.save_key')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
export default ApiKeyModal;
