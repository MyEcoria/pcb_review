import { useState, useEffect } from 'react';
import type { Settings, Provider } from '../../types';
import { getModelsForProvider, validateApiKeyAndModel } from '../../api/llm';
import styles from './SettingsPanel.module.css';

interface SettingsPanelProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onProviderChange: (provider: Provider) => void;
  onClose: () => void;
}

export function SettingsPanel({
  settings,
  onSettingsChange,
  onProviderChange,
  onClose,
}: SettingsPanelProps) {
  const [localSettings, setLocalSettings] = useState(settings);
  const [showApiKey, setShowApiKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null);

  const models = getModelsForProvider(localSettings.provider);
  const hasCatalogModels = models.length > 0;

  useEffect(() => {
    // Reset validation when key, provider, model, or base URL changes
    setValidationResult(null);
  }, [localSettings.apiKey, localSettings.provider, localSettings.model, localSettings.baseUrl]);

  const handleValidate = async () => {
    if (!localSettings.apiKey) return;

    setValidating(true);
    try {
      const result = await validateApiKeyAndModel(
        localSettings.provider,
        localSettings.apiKey,
        localSettings.model,
        localSettings.baseUrl
      );
      setValidationResult(result);
    } catch (err) {
      setValidationResult({
        valid: false,
        error: err instanceof Error ? err.message : 'Validation failed'
      });
    } finally {
      setValidating(false);
    }
  };

  const handleSave = () => {
    onSettingsChange(localSettings);
    onClose();
  };

  const handleProviderChange = (provider: Provider) => {
    // Get models for the NEW provider, not the current one
    const newProviderModels = getModelsForProvider(provider);
    onProviderChange(provider);
    setLocalSettings(prev => ({
      ...prev,
      provider,
      model: newProviderModels[0]?.id || prev.model || '',
    }));
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className={styles.closeButton} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className={styles.content}>
          {/* Provider Selection */}
          <div className={styles.field}>
            <label className={styles.label}>LLM Provider</label>
            <div className={styles.providerOptions}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="provider"
                  value="openai"
                  checked={localSettings.provider === 'openai'}
                  onChange={() => handleProviderChange('openai')}
                />
                <span>OpenAI</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="provider"
                  value="anthropic"
                  checked={localSettings.provider === 'anthropic'}
                  onChange={() => handleProviderChange('anthropic')}
                />
                <span>Anthropic</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="provider"
                  value="gemini"
                  checked={localSettings.provider === 'gemini'}
                  onChange={() => handleProviderChange('gemini')}
                />
                <span>Google Gemini</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="provider"
                  value="ollama_cloud"
                  checked={localSettings.provider === 'ollama_cloud'}
                  onChange={() => handleProviderChange('ollama_cloud')}
                />
                <span>Ollama Cloud</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="provider"
                  value="openai_compatible"
                  checked={localSettings.provider === 'openai_compatible'}
                  onChange={() => handleProviderChange('openai_compatible')}
                />
                <span>Custom OpenAI-compatible</span>
              </label>
            </div>
          </div>

          {/* Model Selection */}
          <div className={styles.field}>
            <label className={styles.label}>Model</label>
            {hasCatalogModels ? (
              <select
                className={styles.select}
                value={localSettings.model}
                onChange={(e) =>
                  setLocalSettings(prev => ({ ...prev, model: e.target.value }))
                }
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className={styles.input}
                value={localSettings.model}
                onChange={(e) =>
                  setLocalSettings(prev => ({ ...prev, model: e.target.value }))
                }
                placeholder="Enter model id (provider-defined)"
              />
            )}
          </div>

          {/* Base URL for custom OpenAI-compatible providers */}
          {localSettings.provider === 'openai_compatible' && (
            <div className={styles.field}>
              <label className={styles.label}>Base URL</label>
              <input
                type="text"
                className={styles.input}
                value={localSettings.baseUrl || ''}
                onChange={(e) =>
                  setLocalSettings(prev => ({ ...prev, baseUrl: e.target.value }))
                }
                placeholder="https://your-provider.example/v1"
              />
            </div>
          )}

          {/* API Key */}
          <div className={styles.field}>
            <label className={styles.label}>API Key</label>
            <div className={styles.apiKeyRow}>
              <input
                type={showApiKey ? 'text' : 'password'}
                className={styles.input}
                value={localSettings.apiKey}
                onChange={(e) =>
                  setLocalSettings(prev => ({ ...prev, apiKey: e.target.value }))
                }
                placeholder={
                  localSettings.provider === 'openai' || localSettings.provider === 'openai_compatible'
                    ? 'sk-...'
                    : localSettings.provider === 'anthropic'
                    ? 'sk-ant-...'
                    : localSettings.provider === 'ollama_cloud'
                    ? 'oc-...'
                    : 'AIza...'
                }
              />
              <button
                type="button"
                className={styles.toggleButton}
                onClick={() => setShowApiKey(!showApiKey)}
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showApiKey ? '🙈' : '👁️'}
              </button>
            </div>
            <div className={styles.keyActions}>
              <button
                type="button"
                className={styles.validateButton}
                onClick={handleValidate}
                disabled={
                  !localSettings.apiKey
                  || !localSettings.model
                  || (localSettings.provider === 'openai_compatible' && !localSettings.baseUrl)
                  || validating
                }
              >
                {validating ? 'Validating...' : 'Validate'}
              </button>
              {validationResult?.valid && (
                <span className={styles.keyValid}>✓ Key and model validated</span>
              )}
              {validationResult && !validationResult.valid && (
                <span className={styles.keyInvalid}>
                  ✗ {validationResult.error || 'Invalid configuration'}
                </span>
              )}
            </div>
          </div>

          {/* Save API Key Option */}
          <div className={styles.field}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={localSettings.saveApiKey}
                onChange={(e) =>
                  setLocalSettings(prev => ({ ...prev, saveApiKey: e.target.checked }))
                }
              />
              <span>Save API key to browser storage</span>
            </label>
            {localSettings.saveApiKey && (
              <p className={styles.warning}>
                &#9888; Only use on trusted devices
              </p>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Analysis depth</label>
            <select
              className={styles.select}
              value={localSettings.analysisDepthMode}
              onChange={(e) =>
                setLocalSettings(prev => ({
                  ...prev,
                  analysisDepthMode: e.target.value === 'fast' ? 'fast' : 'full',
                }))
              }
            >
              <option value="full">Full mode (maximum detail)</option>
              <option value="fast">Fast mode (summarized payloads, lower latency)</option>
            </select>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.saveButton} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
