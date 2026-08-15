import React, { useState, useEffect } from 'react';
import { KeyRound, ExternalLink, CheckCircle2, AlertCircle, Loader2, X, Sparkles } from 'lucide-react';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';

export type ProviderType = 'openai' | 'google' | 'anthropic' | 'mistral';

interface ProviderConfig {
  id: ProviderType;
  name: string;
  badge: string;
  keyPlaceholder: string;
  portalUrl: string;
  portalLabel: string;
  description: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    badge: 'GPT-4o & Mini',
    keyPlaceholder: 'sk-proj-...',
    portalUrl: 'https://platform.openai.com/api-keys',
    portalLabel: 'OpenAI API-Key erstellen',
    description: 'Bewährter Standard mit automatischem Hybrid-Routing.',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    badge: 'Gemini 2.0 Flash & 1.5 Pro',
    keyPlaceholder: 'AIzaSy...',
    portalUrl: 'https://aistudio.google.com/app/apikey',
    portalLabel: 'Google AI Studio Key erstellen',
    description: 'Extrem schnelles Gemini 2.0 Flash & Gemini 1.5 Pro.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    badge: 'Claude 3.7 Sonnet & 3.5 Haiku',
    keyPlaceholder: 'sk-ant-api03-...',
    portalUrl: 'https://console.anthropic.com/settings/keys',
    portalLabel: 'Anthropic Console Key erstellen',
    description: 'Höchste Präzision für komplexe mathematische Formeln und LaTeX.',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    badge: 'Mistral OCR & Pixtral',
    keyPlaceholder: 'mis_...',
    portalUrl: 'https://console.mistral.ai/api-keys/',
    portalLabel: 'Mistral Console Key erstellen',
    description: 'Spezialisiertes Mistral Document OCR & Pixtral 12B.',
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
  const [selectedTab, setSelectedTab] = useState<ProviderType>(activeProvider);
  const [currentInput, setCurrentInput] = useState<string>('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    setSelectedTab(activeProvider);
  }, [activeProvider, isOpen]);

  // Sync input when tab changes or modal opens (without erasing testResult on key save)
  useEffect(() => {
    setCurrentInput(providerKeys[selectedTab] || '');
    setTestResult(null);
  }, [selectedTab, isOpen]);

  if (!isOpen) return null;

  const currentProviderInfo = PROVIDERS.find((p) => p.id === selectedTab)!;
  const hasAnyKey = Object.values(providerKeys).some((k) => k && k.trim().length > 0);

  const handleTestKey = async () => {
    if (!currentInput.trim()) {
      setTestResult({ success: false, message: 'Bitte gib zuerst einen API-Key ein.' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      await invoke<boolean>('validate_api_key_native', {
        provider: selectedTab,
        key: currentInput.trim(),
      });
      setTestResult({ success: true, message: `${currentProviderInfo.name} Key ist gültig!` });
      onSaveKey(selectedTab, currentInput.trim());
    } catch (err: any) {
      setTestResult({
        success: false,
        message: typeof err === 'string' ? err : 'Ungültiger API-Key oder keine Verbindung.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleOpenPortal = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await openUrl(currentProviderInfo.portalUrl);
    } catch {
      window.open(currentProviderInfo.portalUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSaveAndProceed = () => {
    if (currentInput.trim()) {
      onSaveKey(selectedTab, currentInput.trim());
    }
    onSelectProvider(selectedTab);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="glass-card w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-6 relative border border-border">
        {/* Close Button */}
        {hasAnyKey && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-5 right-5 text-slate-400 hover:text-slate-100 transition p-1 rounded-lg hover:bg-surface-hover cursor-pointer"
            title="Schließen"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Modal Header */}
        <div className="flex items-center space-x-3 border-b border-border pb-4 pr-8">
          <div className="p-2.5 bg-accent/20 text-accent rounded-xl">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              KI-Provider & API-Keys <Sparkles className="w-4 h-4 text-amber-400" />
            </h2>
            <p className="text-xs text-slate-400">Wähle deinen Provider und hinterlege den API-Key</p>
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
                className={`py-2 px-2 rounded-lg text-xs font-semibold flex flex-col items-center gap-1 transition cursor-pointer ${
                  isSelected
                    ? 'bg-accent text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
                }`}
              >
                <span>{provider.name}</span>
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

        {/* Selected Provider Card */}
        <div className="p-3.5 bg-surface/60 border border-border rounded-xl space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-slate-200">{currentProviderInfo.name}</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 bg-accent/20 text-accent rounded-md">
              {currentProviderInfo.badge}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">{currentProviderInfo.description}</p>
        </div>

        {/* Key Input Field */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              {currentProviderInfo.name} API-Key
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
              {currentProviderInfo.portalLabel} <ExternalLink className="w-3.5 h-3.5" />
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

        {/* Action Buttons */}
        <div className="flex space-x-3 pt-2">
          <button
            type="button"
            onClick={handleTestKey}
            disabled={testing || !currentInput.trim()}
            className="flex-1 py-3 px-4 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl font-medium text-sm transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Key testen'}
          </button>

          <button
            type="button"
            onClick={handleSaveAndProceed}
            disabled={!currentInput.trim() && !hasAnyKey}
            className="flex-1 py-3 px-4 bg-accent hover:bg-accent-hover text-white rounded-xl font-medium text-sm transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-lg shadow-accent/20"
          >
            Als aktiv festlegen & Weiter
          </button>
        </div>
      </div>
    </div>
  );
};
