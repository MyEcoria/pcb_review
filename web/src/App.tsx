import { useState, useCallback, useMemo, useRef } from 'react';
import { useTheme } from './hooks/useTheme';
import { useLocalStorage } from './hooks/useLocalStorage';
import { Header } from './components/Header/Header';
import { HistoryPanel } from './components/HistoryPanel/HistoryPanel';
import { SettingsPanel } from './components/SettingsPanel/SettingsPanel';
import { FileUpload } from './components/FileUpload/FileUpload';
import { DescriptionInput } from './components/DescriptionInput/DescriptionInput';
import { AnalysisSelector } from './components/AnalysisSelector/AnalysisSelector';
import { ReviewRunner } from './components/ReviewRunner/ReviewRunner';
import { AnalysisModal } from './components/AnalysisModal/AnalysisModal';
import { ResultsView } from './components/ResultsView/ResultsView';
import { SlideOutChat } from './components/SlideOutChat/SlideOutChat';
import { HelpModal } from './components/HelpModal/HelpModal';
import { getDefaultModel } from './api/llm';
import { downloadMarkdown, exportAsPDF } from './utils/export';
import type { Settings, UploadedFile, AnalysisResult, ReviewResult, LLMConfig, ReviewScoreSummary, ReviewStatus, ReviewRunHistory, RunComparisonSummary, RunMetadata } from './types';
import './styles/global.css';
import styles from './App.module.css';

// Default settings
const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: '',
  baseUrl: '',
  organization: '',
  saveApiKey: false,
  theme: 'auto',
  analysisDepthMode: 'full',
};

export default function App() {
  const { theme, setTheme } = useTheme();

  // Settings state (partially persisted)
  const [savedSettings, setSavedSettings] = useLocalStorage<Partial<Settings>>(
    'pcb-review-settings',
    {}
  );

  const [settings, setSettings] = useState<Settings>(() => ({
    ...DEFAULT_SETTINGS,
    ...savedSettings,
    // Only restore API key if saveApiKey was true
    apiKey: savedSettings.saveApiKey ? (savedSettings.apiKey || '') : '',
  }));

  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // File state
  const [pcbFile, setPcbFile] = useState<UploadedFile | null>(null);
  const [schematicFiles, setSchematicFiles] = useState<UploadedFile[]>([]);

  // User input
  const [description, setDescription] = useState('');
  const [selectedAnalyses, setSelectedAnalyses] = useState<string[]>([
    'general-review',
    'power-analysis',
    'signal-integrity',
    'dfm-analysis',
  ]);

  // Analysis state
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // Review state
  const [reviewResults, setReviewResults] = useState<ReviewResult[]>([]);
  const [executiveSummary, setExecutiveSummary] = useState<string>('');

  // View state
  const [currentView, setCurrentView] = useState<'main' | 'results' | 'history'>('main');

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);

  // Modal state
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<ReviewStatus>('idle');
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [currentAnalysisName, setCurrentAnalysisName] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const cancelAnalysisRef = useRef<(() => void) | null>(null);

  const [runHistory, setRunHistory] = useLocalStorage<ReviewRunHistory[]>(
    'pcb-review-history',
    []
  );
  const [activeRunMetadata, setActiveRunMetadata] = useState<RunMetadata | null>(null);
  const [comparisonSummary, setComparisonSummary] = useState<RunComparisonSummary | null>(null);

  const buildComparisonSummary = useCallback((currentRun: ReviewRunHistory, baselineRun: ReviewRunHistory): RunComparisonSummary => {
    const baselineFailures = new Set(
      baselineRun.resultsSnapshot.flatMap(result =>
        (result.checks ?? [])
          .filter(check => check.status === 'fail')
          .map(check => `${result.promptName}::${check.title}`)
      )
    );

    const newFailures = currentRun.resultsSnapshot.flatMap(result =>
      (result.checks ?? [])
        .filter(check => check.status === 'fail')
        .filter(check => !baselineFailures.has(`${result.promptName}::${check.title}`))
        .map(check => ({
          promptName: result.promptName,
          checkTitle: check.title,
          severity: check.severity,
        }))
    );

    return {
      comparedTo: {
        runId: baselineRun.runId,
        timestamp: baselineRun.timestamp,
        provider: baselineRun.provider,
        model: baselineRun.model,
        selectedAnalyses: baselineRun.selectedAnalyses,
      },
      delta: {
        passed: currentRun.scoreSummary.passed - baselineRun.scoreSummary.passed,
        failed: currentRun.scoreSummary.failed - baselineRun.scoreSummary.failed,
        warnings: currentRun.scoreSummary.warnings - baselineRun.scoreSummary.warnings,
      },
      newFailures,
    };
  }, []);

  // Build LLM config from settings
  const llmConfig: LLMConfig = {
    provider: settings.provider,
    model: settings.model,
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    organization: settings.organization,
  };

  // Handlers
  const handleSettingsChange = useCallback((newSettings: Settings) => {
    setSettings(newSettings);

    // Persist settings (without API key unless saveApiKey is true)
    const toSave: Partial<Settings> = {
      provider: newSettings.provider,
      model: newSettings.model,
      baseUrl: newSettings.baseUrl,
      organization: newSettings.organization,
      saveApiKey: newSettings.saveApiKey,
      theme: newSettings.theme,
      analysisDepthMode: newSettings.analysisDepthMode,
    };

    if (newSettings.saveApiKey) {
      toSave.apiKey = newSettings.apiKey;
    }

    setSavedSettings(toSave);
  }, [setSavedSettings]);

  const handleThemeChange = useCallback((newTheme: Settings['theme']) => {
    setTheme(newTheme);
    setSettings(prev => ({ ...prev, theme: newTheme }));
  }, [setTheme]);

  const handleProviderChange = useCallback((provider: Settings['provider']) => {
    const newModel = getDefaultModel(provider);
    setSettings(prev => ({ ...prev, provider, model: newModel }));
  }, []);

  const handleFilesParsed = useCallback((result: AnalysisResult) => {
    setAnalysisResult(result);
  }, []);


  const aggregateScoreSummary = useMemo<ReviewScoreSummary>(() => {
    return reviewResults.reduce<ReviewScoreSummary>((acc, result) => {
      const summary = result.scoreSummary;
      if (!summary) {
        return acc;
      }

      acc.total += summary.total;
      acc.passed += summary.passed;
      acc.failed += summary.failed;
      acc.warnings += summary.warnings;
      acc.score += summary.score;
      return acc;
    }, {
      total: 0,
      passed: 0,
      failed: 0,
      warnings: 0,
      score: 0,
    });
  }, [reviewResults]);

  const handleReviewComplete = useCallback((results: ReviewResult[], summary: string) => {
    setReviewResults(results);
    setExecutiveSummary(summary);

    const runScoreSummary = results.reduce<ReviewScoreSummary>((acc, result) => {
      if (!result.scoreSummary) return acc;
      acc.total += result.scoreSummary.total;
      acc.passed += result.scoreSummary.passed;
      acc.failed += result.scoreSummary.failed;
      acc.warnings += result.scoreSummary.warnings;
      acc.score += result.scoreSummary.score;
      return acc;
    }, { total: 0, passed: 0, failed: 0, warnings: 0, score: 0 });

    const runTimestamp = Date.now();
    const runId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `run-${runTimestamp}`;
    const runEntry: ReviewRunHistory = {
      runId,
      timestamp: runTimestamp,
      provider: settings.provider,
      model: settings.model,
      selectedAnalyses: [...selectedAnalyses],
      scoreSummary: runScoreSummary,
      resultsSnapshot: results,
      executiveSummary: summary,
      description,
      analysisResult,
    };

    setRunHistory(prev => [runEntry, ...prev]);
    setActiveRunMetadata({
      runId: runEntry.runId,
      timestamp: runEntry.timestamp,
      provider: runEntry.provider,
      model: runEntry.model,
      selectedAnalyses: runEntry.selectedAnalyses,
    });

    if (runHistory.length > 0) {
      setComparisonSummary(buildComparisonSummary(runEntry, runHistory[0]));
    } else {
      setComparisonSummary(null);
    }
  }, [settings.provider, settings.model, selectedAnalyses, aggregateScoreSummary, description, analysisResult, setRunHistory, runHistory, buildComparisonSummary]);

  const handlePartialResult = useCallback((result: ReviewResult) => {
    setReviewResults(prev => {
      // Replace if exists, otherwise add
      const existing = prev.findIndex(r => r.promptId === result.promptId);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = result;
        return updated;
      }
      return [...prev, result];
    });
  }, []);

  const handleStatusChange = useCallback((
    status: ReviewStatus,
    progress: { current: number; total: number },
    currentAnalysis: string,
    streaming: string,
    error: string | null
  ) => {
    setAnalysisStatus(status);
    setAnalysisProgress(progress);
    setCurrentAnalysisName(currentAnalysis);
    setStreamingContent(streaming);
    setAnalysisError(error);

    // Show modal when analysis starts
    if (status === 'running' && !showAnalysisModal) {
      setShowAnalysisModal(true);
    }
  }, [showAnalysisModal]);

  const handleCancelAnalysis = useCallback(() => {
    cancelAnalysisRef.current?.();
  }, []);

  const handleViewResults = useCallback(() => {
    setShowAnalysisModal(false);
    setCurrentView('results');
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowAnalysisModal(false);
    setAnalysisStatus('idle');
  }, []);

  const handleBackToMain = useCallback(() => {
    setCurrentView('main');
  }, []);

  const handleOpenHistory = useCallback(() => {
    setCurrentView('history');
  }, []);

  const handleLoadHistoryRun = useCallback((run: ReviewRunHistory) => {
    setReviewResults(run.resultsSnapshot);
    setExecutiveSummary(run.executiveSummary);
    setAnalysisResult(run.analysisResult);
    setDescription(run.description);
    setSelectedAnalyses(run.selectedAnalyses);
    setActiveRunMetadata({
      runId: run.runId,
      timestamp: run.timestamp,
      provider: run.provider,
      model: run.model,
      selectedAnalyses: run.selectedAnalyses,
    });

    const baseline = runHistory.find(entry => entry.timestamp < run.timestamp);
    setComparisonSummary(baseline ? buildComparisonSummary(run, baseline) : null);
    setCurrentView('results');
  }, [runHistory, buildComparisonSummary]);

  const handleDeleteHistoryRun = useCallback((runId: string) => {
    setRunHistory(prev => prev.filter(run => run.runId !== runId));
  }, [setRunHistory]);

  const handleClearHistory = useCallback(() => {
    setRunHistory([]);
  }, [setRunHistory]);

  const handleExportMarkdown = useCallback(() => {
    downloadMarkdown(reviewResults, analysisResult, description, aggregateScoreSummary, activeRunMetadata);
  }, [reviewResults, analysisResult, description, aggregateScoreSummary, activeRunMetadata]);

  const handleExportPDF = useCallback(() => {
    exportAsPDF(reviewResults, analysisResult, executiveSummary, description, aggregateScoreSummary, activeRunMetadata);
  }, [reviewResults, analysisResult, executiveSummary, description, aggregateScoreSummary, activeRunMetadata]);

  // Results View
  if (currentView === 'results') {
    return (
      <div className={styles.resultsLayout}>
        <div className={styles.resultsContent}>
          <ResultsView
            results={reviewResults}
            analysisResult={analysisResult}
            executiveSummary={executiveSummary}
            onBack={handleBackToMain}
            onExportMarkdown={handleExportMarkdown}
            onExportPDF={handleExportPDF}
            scoreSummary={aggregateScoreSummary}
            runMetadata={activeRunMetadata}
            comparisonSummary={comparisonSummary}
          />
        </div>
        {/* Slide-out Chat Panel */}
        <SlideOutChat
          llmConfig={llmConfig}
          reviewResults={reviewResults}
          analysisResult={analysisResult}
          description={description}
          isOpen={chatOpen}
          onOpenChange={setChatOpen}
        />
      </div>
    );
  }

  if (currentView === 'history') {
    return (
      <HistoryPanel
        history={runHistory}
        onBack={handleBackToMain}
        onLoadRun={handleLoadHistoryRun}
        onDeleteRun={handleDeleteHistoryRun}
        onClearAll={handleClearHistory}
      />
    );
  }

  // Main View
  return (
    <div className={styles.app}>
      <Header
        theme={theme}
        onThemeChange={handleThemeChange}
        onSettingsClick={() => setShowSettings(true)}
        onHelpClick={() => setShowHelp(true)}
      />

      <main className={styles.main}>
        <div className={styles.container}>
          <div className={styles.historyBar}>
            <button className={styles.historyButton} onClick={handleOpenHistory}>
              View Run History ({runHistory.length})
            </button>
          </div>
          {/* File Upload Section */}
          <section className={styles.section}>
            <FileUpload
              pcbFile={pcbFile}
              schematicFiles={schematicFiles}
              onPcbFileChange={setPcbFile}
              onSchematicFilesChange={setSchematicFiles}
              onFilesParsed={handleFilesParsed}
            />
          </section>

          {/* Description Section */}
          <section className={styles.section}>
            <DescriptionInput
              value={description}
              onChange={setDescription}
            />
          </section>

          {/* Analysis Selection */}
          <section className={styles.section}>
            <AnalysisSelector
              selectedAnalyses={selectedAnalyses}
              onChange={setSelectedAnalyses}
            />
          </section>

          {/* Review Runner */}
          <section className={styles.section}>
            <ReviewRunner
              analysisResult={analysisResult}
              description={description}
              selectedAnalyses={selectedAnalyses}
              llmConfig={llmConfig}
              onReviewComplete={handleReviewComplete}
              onPartialResult={handlePartialResult}
              onStatusChange={handleStatusChange}
              onCancelRef={cancelAnalysisRef}
              onOpenSettings={() => setShowSettings(true)}
              analysisDepthMode={settings.analysisDepthMode}
            />
          </section>

        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onProviderChange={handleProviderChange}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Analysis Progress Modal */}
      <AnalysisModal
        isOpen={showAnalysisModal}
        status={analysisStatus}
        progress={analysisProgress}
        currentAnalysis={currentAnalysisName}
        streamingContent={streamingContent}
        error={analysisError}
        onCancel={analysisStatus === 'running' ? handleCancelAnalysis : handleCloseModal}
        onViewResults={handleViewResults}
      />

      {/* Help Modal */}
      <HelpModal
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
      />
    </div>
  );
}
