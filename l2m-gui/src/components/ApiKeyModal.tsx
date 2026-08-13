import React, { useState } from 'react';
import { KeyRound, ExternalLink, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { open as openUrl } from '@tauri-apps/plugin-shell';

interface ApiKeyModalProps {
  isOpen: boolean;
  apiKey: string;
  onSaveKey: (key: string) => void;
  onClose: () => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  apiKey: initialKey,
  onSaveKey,
  onClose,
}) => {
  const [keyInput, setKeyInput] = useState(initialKey);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  if (!isOpen) return null;

  const handleTestKey = async () => {
    if (!keyInput.trim()) {
      setTestResult({ success: false, message: 'Bitte gib zuerst einen API-Key ein.' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      // client.models.list() Equivalent: GET https://api.openai.com/v1/models (0 Tokens Cost)
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${keyInput.trim()}`,
        },
      });

      if (response.ok) {
        setTestResult({ success: true, message: 'Key ist gültig!' });
        onSaveKey(keyInput.trim());
      } else {
        const errorData = await response.json().catch(() => ({}));
        setTestResult({
          success: false,
          message: errorData.error?.message || 'Ungültiger API-Key oder keine Verbindung.',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: 'Netzwerkfehler beim Testen des API-Keys.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleOpenOpenAI = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = 'https://platform.openai.com/api-keys';
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleOpenUsageDashboard = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = 'https://platform.openai.com/usage';
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleProceed = () => {
    onSaveKey(keyInput.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="glass-card w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-6">
        <div className="flex items-center space-x-3 border-b border-border pb-4">
          <div className="p-2.5 bg-accent/20 text-accent rounded-xl">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100">OpenAI API-Key Einrichten</h2>
            <p className="text-xs text-slate-400">Erforderlich für die Konvertierung deiner Folien</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Dein OpenAI API-Key
            </label>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value);
                setTestResult(null);
              }}
              placeholder="sk-proj-..."
              className="w-full px-4 py-3 bg-background border border-border rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent text-sm transition"
            />
          </div>

          <div className="flex justify-between items-center text-xs">
            <button
              type="button"
              onClick={handleOpenOpenAI}
              className="inline-flex items-center text-accent hover:underline gap-1 transition cursor-pointer font-medium bg-transparent border-0 p-0"
            >
              API-Key bei OpenAI erstellen <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-200/90 leading-relaxed flex items-start space-x-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p>
                <strong>Hinweis:</strong> Bei der Nutzung des API-Keys entstehen Kosten bei OpenAI.
              </p>
              <p>
                Deine aktuellen Kosten kannst du jederzeit im{' '}
                <button
                  type="button"
                  onClick={handleOpenUsageDashboard}
                  className="inline-flex items-center text-amber-300 hover:text-amber-100 underline gap-1 font-semibold bg-transparent border-0 p-0 cursor-pointer"
                >
                  OpenAI Verbrauchsdashboard <ExternalLink className="w-3 h-3" />
                </button>{' '}
                einsehen.
              </p>
            </div>
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-xl flex items-center space-x-2 text-xs font-medium ${testResult.success
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

        <div className="flex space-x-3 pt-2">
          <button
            type="button"
            onClick={handleTestKey}
            disabled={testing || !keyInput.trim()}
            className="flex-1 py-3 px-4 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl font-medium text-sm transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Key testen'}
          </button>

          <button
            type="button"
            onClick={handleProceed}
            disabled={!keyInput.trim()}
            className="flex-1 py-3 px-4 bg-accent hover:bg-accent-hover text-white rounded-xl font-medium text-sm transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
};
