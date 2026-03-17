import { useState, useCallback, useRef } from 'react';
import type { AnalysisResult, LLMConfig, ReviewCheck, ReviewResult, ReviewScoreSummary, ReviewStatus } from '../../types';
import { getPromptById, FAB_CAPABILITIES_REFERENCE } from '../../prompts';
import { callLLM } from '../../api/llm';
import styles from './ReviewRunner.module.css';

interface ReviewRunnerProps {
  analysisResult: AnalysisResult | null;
  description: string;
  selectedAnalyses: string[];
  llmConfig: LLMConfig;
  onReviewComplete: (results: ReviewResult[], executiveSummary: string) => void;
  onPartialResult?: (result: ReviewResult) => void;
  onStatusChange?: (status: ReviewStatus, progress: { current: number; total: number }, currentAnalysis: string, streamingContent: string, error: string | null) => void;
  onCancelRef?: React.MutableRefObject<(() => void) | null>;
  onOpenSettings?: () => void;
  analysisDepthMode?: AnalysisDepthMode;
}

type AnalysisDepthMode = 'fast' | 'full';
type DataDetailLevel = 'full' | 'summarized';

interface PromptPayloadSet {
  summary: unknown;
  power: unknown;
  signals: unknown;
  components: unknown;
  dfm: unknown;
}

interface PreprocessedPromptData {
  payloads: PromptPayloadSet;
  detailLevel: DataDetailLevel;
  estimatedBytes: number;
  estimatedTokens: number;
}

const DEFAULT_ARRAY_SAMPLE_SIZE = 40;
const FAST_MODE_ARRAY_SAMPLE_SIZE = 20;
const MAX_PROMPT_BYTES = 90_000;
const MAX_PROMPT_TOKENS = 22_000;

function estimateSize(text: string): { bytes: number; tokens: number } {
  const bytes = new TextEncoder().encode(text).length;
  return { bytes, tokens: Math.ceil(bytes / 4) };
}

function summarizeArray(value: unknown, key: string, sampleSize: number): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  if (value.length <= sampleSize) {
    return value;
  }

  const stride = Math.max(1, Math.floor(value.length / sampleSize));
  const sample: unknown[] = [];
  for (let i = 0; i < value.length && sample.length < sampleSize; i += stride) {
    sample.push(value[i]);
  }

  const rangeSummary = value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .reduce<Record<string, { min?: number; max?: number }>>((acc, item) => {
      for (const [itemKey, itemValue] of Object.entries(item)) {
        if (typeof itemValue !== 'number' || !Number.isFinite(itemValue)) {
          continue;
        }
        const current = acc[itemKey] || {};
        current.min = current.min === undefined ? itemValue : Math.min(current.min, itemValue);
        current.max = current.max === undefined ? itemValue : Math.max(current.max, itemValue);
        acc[itemKey] = current;
      }
      return acc;
    }, {});

  return {
    summaryType: `${key}-sample`,
    totalCount: value.length,
    sampledCount: sample.length,
    sampleStride: stride,
    numericRanges: rangeSummary,
    representativeSample: sample,
  };
}

function summarizeRecordArrays(record: Record<string, unknown>, keyPrefix: string, sampleSize: number): Record<string, unknown> {
  return Object.entries(record).reduce<Record<string, unknown>>((acc, [key, val]) => {
    acc[key] = summarizeArray(val, `${keyPrefix}.${key}`, sampleSize);
    return acc;
  }, {});
}

function buildPromptPayloads(
  analysisResult: AnalysisResult,
  detailLevel: DataDetailLevel,
  depthMode: AnalysisDepthMode,
): PromptPayloadSet {
  const sampleSize = depthMode === 'fast' || detailLevel === 'summarized'
    ? FAST_MODE_ARRAY_SAMPLE_SIZE
    : DEFAULT_ARRAY_SAMPLE_SIZE;
  const shouldSummarize = detailLevel === 'summarized' || depthMode === 'fast';

  const componentsByType = shouldSummarize
    ? summarizeRecordArrays(analysisResult.components.byType, 'components.byType', sampleSize)
    : analysisResult.components.byType;

  const componentsAll = shouldSummarize
    ? summarizeArray(analysisResult.components.all, 'components.all', sampleSize)
    : analysisResult.components.all;

  const powerICs = analysisResult.components.byType['IC_POWER'] || [];
  const inductors = analysisResult.components.byType['INDUCTOR'] || [];
  const capacitors = analysisResult.components.byType['CAPACITOR'] || [];

  const powerPayload = {
    powerNets: shouldSummarize ? summarizeArray(analysisResult.powerNets, 'powerNets', sampleSize) : analysisResult.powerNets,
    powerComponents: {
      regulators: shouldSummarize ? summarizeArray(powerICs, 'power.regulators', sampleSize) : powerICs,
      inductors: shouldSummarize ? summarizeArray(inductors, 'power.inductors', sampleSize) : inductors,
      capacitorCount: capacitors.length,
      capacitors: shouldSummarize ? summarizeArray(capacitors, 'power.capacitors', sampleSize) : capacitors,
    },
    thermalAnalysis: shouldSummarize ? summarizeArray(analysisResult.thermalAnalysis, 'thermalAnalysis', sampleSize) : analysisResult.thermalAnalysis,
  };

  const signalPayload = {
    signalNets: shouldSummarize ? summarizeArray(analysisResult.signalNets, 'signalNets', sampleSize) : analysisResult.signalNets,
    differentialPairs: shouldSummarize ? summarizeArray(analysisResult.differentialPairs, 'differentialPairs', sampleSize) : analysisResult.differentialPairs,
    traceStats: analysisResult.traceStats,
    layerStackup: analysisResult.layerStackup,
  };

  const componentsPayload = {
    byType: componentsByType,
    all: componentsAll,
    fullCounts: {
      totalComponents: analysisResult.summary.totalComponents,
      byType: Object.entries(analysisResult.components.byType).reduce<Record<string, number>>((acc, [key, value]) => {
        acc[key] = Array.isArray(value) ? value.length : 0;
        return acc;
      }, {}),
    },
    crossReference: analysisResult.crossReference,
  };

  const dfmPayload = {
    viaStats: analysisResult.viaStats,
    viaInPad: shouldSummarize ? summarizeArray(analysisResult.viaInPad, 'viaInPad', sampleSize) : analysisResult.viaInPad,
    traceStats: analysisResult.traceStats,
    layerStackup: analysisResult.layerStackup,
    summaryMetrics: {
      totalTraces: analysisResult.summary.totalTraces,
      totalVias: analysisResult.summary.totalVias,
      viaInPadCount: analysisResult.summary.viaInPadCount,
    },
  };

  return {
    summary: analysisResult.summary,
    power: powerPayload,
    signals: signalPayload,
    components: componentsPayload,
    dfm: dfmPayload,
  };
}

function buildPreprocessedPromptData(
  analysisResult: AnalysisResult,
  depthMode: AnalysisDepthMode,
): PreprocessedPromptData {
  const fullPayloads = buildPromptPayloads(analysisResult, 'full', depthMode);
  const fullSize = estimateSize(JSON.stringify(fullPayloads));

  if (fullSize.bytes > MAX_PROMPT_BYTES || fullSize.tokens > MAX_PROMPT_TOKENS) {
    const summarizedPayloads = buildPromptPayloads(analysisResult, 'summarized', depthMode);
    const summarizedSize = estimateSize(JSON.stringify(summarizedPayloads));
    return {
      payloads: summarizedPayloads,
      detailLevel: 'summarized',
      estimatedBytes: summarizedSize.bytes,
      estimatedTokens: summarizedSize.tokens,
    };
  }

  return {
    payloads: fullPayloads,
    detailLevel: depthMode === 'fast' ? 'summarized' : 'full',
    estimatedBytes: fullSize.bytes,
    estimatedTokens: fullSize.tokens,
  };
}


function calculateReviewScoreSummary(checks: ReviewCheck[]): ReviewScoreSummary {
  const passed = checks.filter(check => check.status === 'pass').length;
  const failed = checks.filter(check => check.status === 'fail').length;
  const warnings = checks.filter(check => check.status === 'warning').length;
  const total = checks.length;

  return {
    total,
    passed,
    failed,
    warnings,
    score: passed,
  };
}

function normalizeCheck(raw: Record<string, unknown>, index: number): ReviewCheck {
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `check-${index + 1}`;
  const status = raw.status === 'pass' || raw.status === 'fail' || raw.status === 'warning' ? raw.status : 'warning';
  const severity = raw.severity === 'critical' || raw.severity === 'high' || raw.severity === 'medium' || raw.severity === 'low' || raw.severity === 'info'
    ? raw.severity
    : status === 'fail'
      ? 'high'
      : status === 'warning'
        ? 'medium'
        : 'info';

  return {
    id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : `Check ${index + 1}`,
    status,
    severity,
    evidence: typeof raw.evidence === 'string' ? raw.evidence : '',
    suggestion: typeof raw.suggestion === 'string' ? raw.suggestion : '',
    category: typeof raw.category === 'string' ? raw.category : undefined,
  };
}

interface ParsedChecksResult {
  checks: ReviewCheck[];
  parseWarning?: string;
}

function parseStructuredChecks(response: string, expectedAnalysisId: string, minChecks: number): ParsedChecksResult {
  const fencedJsonBlocks = [...response.matchAll(/```json\s*([\s\S]*?)```/gi)].map(match => match[1]?.trim() ?? '');

  for (const block of fencedJsonBlocks) {
    try {
      const parsed = JSON.parse(block) as { analysis_id?: unknown; checks?: unknown };
      if (!Array.isArray(parsed.checks)) {
        continue;
      }

      const checks = parsed.checks
        .filter((check): check is Record<string, unknown> => typeof check === 'object' && check !== null)
        .map((check, index) => normalizeCheck(check, index));

      let parseWarning: string | undefined;
      if (typeof parsed.analysis_id !== 'string' || parsed.analysis_id !== expectedAnalysisId) {
        parseWarning = `Structured output analysis_id mismatch (expected ${expectedAnalysisId}).`;
      }
      if (checks.length < minChecks) {
        const minChecksWarning = `Structured output included ${checks.length} checks; expected at least ${minChecks} for ${expectedAnalysisId}.`;
        parseWarning = parseWarning ? `${parseWarning} ${minChecksWarning}` : minChecksWarning;
      }

      return { checks, parseWarning };
    } catch {
      // Ignore malformed JSON blocks and continue to fallback parsing
    }
  }

  const markdownChecks = response
    .split(/\n\s*\n/)
    .filter(section => /status\s*:/i.test(section) && /suggestion\s*:/i.test(section))
    .map((section, index) => {
      const title = section.match(/\*\*(.+?)\*\*/)?.[1] ?? `Markdown Check ${index + 1}`;
      const status = section.match(/status\s*:\s*(pass|fail|warning)/i)?.[1]?.toLowerCase();
      const severity = section.match(/severity\s*:\s*(critical|high|medium|low|info)/i)?.[1]?.toLowerCase();
      const evidence = section.match(/evidence\s*:\s*(.+)/i)?.[1] ?? '';
      const suggestion = section.match(/suggestion\s*:\s*(.+)/i)?.[1] ?? '';
      const category = section.match(/category\s*:\s*(.+)/i)?.[1];

      return normalizeCheck({
        id: `md-check-${index + 1}`,
        title,
        status,
        severity,
        evidence,
        suggestion,
        category,
      }, index);
    });

  let parseWarning = 'Missing required structured JSON block; fallback markdown parsing was used.';
  if (markdownChecks.length < minChecks) {
    parseWarning += ` Parsed ${markdownChecks.length} fallback checks; expected at least ${minChecks} for ${expectedAnalysisId}.`;
  }

  return { checks: markdownChecks, parseWarning };
}

const EXECUTIVE_SUMMARY_PROMPT = `You are a PCB design review expert. Based on the analysis results provided, write a concise executive summary (2-3 paragraphs) that:

1. Describes the board's key characteristics (layer count, component count, complexity)
2. Highlights the most critical issues or concerns found
3. Provides an overall assessment of design quality and manufacturing readiness

Be specific and technical but accessible. Focus on actionable insights. Do not use bullet points - write in paragraph form.`;

export function ReviewRunner({
  analysisResult,
  description,
  selectedAnalyses,
  llmConfig,
  onReviewComplete,
  onPartialResult,
  onStatusChange,
  onCancelRef,
  onOpenSettings,
  analysisDepthMode = 'full',
}: ReviewRunnerProps) {
  const [status, setStatus] = useState<ReviewStatus>('idle');
  const [_progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [_currentAnalysis, setCurrentAnalysis] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [promptGuardrailNotice, setPromptGuardrailNotice] = useState<string | null>(null);
  const [_streamingContent, setStreamingContent] = useState<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<ReviewResult[]>([]);

  // State is maintained for parent callbacks via onStatusChange
  void _progress; void _currentAnalysis; void _streamingContent;

  // Helper to update status and notify parent
  const updateStatus = useCallback((
    newStatus: ReviewStatus,
    newProgress: { current: number; total: number },
    newCurrentAnalysis: string,
    newStreamingContent: string,
    newError: string | null
  ) => {
    setStatus(newStatus);
    setProgress(newProgress);
    setCurrentAnalysis(newCurrentAnalysis);
    setStreamingContent(newStreamingContent);
    setError(newError);
    onStatusChange?.(newStatus, newProgress, newCurrentAnalysis, newStreamingContent, newError);
  }, [onStatusChange]);

  const canRun =
    analysisResult !== null &&
    selectedAnalyses.length > 0 &&
    llmConfig.apiKey.trim() !== '';

  const buildUserPrompt = useCallback((promptId: string, payloads: PromptPayloadSet): string => {
    const prompt = getPromptById(promptId);
    if (!prompt) return '';

    const parts: string[] = [];

    // Add fabrication capabilities reference for accurate DFM assessment
    parts.push(FAB_CAPABILITIES_REFERENCE);
    parts.push('');

    // Add PCB description
    if (description.trim()) {
      parts.push(`## PCB Description\n${description.trim()}\n`);
    }

    // Add relevant JSON data based on prompt's jsonFiles
    parts.push('## Analysis Data\n');

    for (const jsonFile of prompt.jsonFiles) {
      switch (jsonFile) {
        case 'summary':
          parts.push(`### Summary\n\`\`\`json\n${JSON.stringify(payloads.summary, null, 2)}\n\`\`\`\n`);
          break;
        case 'power': {
          parts.push(`### Power Analysis\n\`\`\`json\n${JSON.stringify(payloads.power, null, 2)}\n\`\`\`\n`);
          break;
        }
        case 'signals': {
          parts.push(`### Signal Analysis\n\`\`\`json\n${JSON.stringify(payloads.signals, null, 2)}\n\`\`\`\n`);
          break;
        }
        case 'components': {
          parts.push(`### Components\n\`\`\`json\n${JSON.stringify(payloads.components, null, 2)}\n\`\`\`\n`);
          break;
        }
        case 'dfm': {
          parts.push(`### DFM Analysis\n\`\`\`json\n${JSON.stringify(payloads.dfm, null, 2)}\n\`\`\`\n`);
          break;
        }
      }
    }

    return parts.join('\n');
  }, [description]);

  const runAnalyses = useCallback(async () => {
    if (!canRun || !analysisResult) return;

    // Create new AbortController for this run
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    resultsRef.current = [];
    // Total includes all analyses plus the executive summary step
    const totalSteps = selectedAnalyses.length + 1;
    updateStatus('running', { current: 0, total: totalSteps }, '', '', null);

    const preprocessedData = buildPreprocessedPromptData(analysisResult, analysisDepthMode);
    if (preprocessedData.detailLevel === 'summarized') {
      setPromptGuardrailNotice(`Large analysis dataset detected (~${preprocessedData.estimatedTokens.toLocaleString()} tokens estimate). Using summarized mode for faster and safer prompt delivery.`);
    } else {
      setPromptGuardrailNotice(null);
    }

    for (let i = 0; i < selectedAnalyses.length; i++) {
      if (signal.aborted) {
        updateStatus('cancelled', { current: i, total: totalSteps }, '', '', null);
        onReviewComplete(resultsRef.current, '');
        return;
      }

      const promptId = selectedAnalyses[i]!;
      const prompt = getPromptById(promptId);

      if (!prompt) continue;

      updateStatus('running', { current: i, total: totalSteps }, prompt.name, '', null);

      try {
        const userPrompt = buildUserPrompt(promptId, preprocessedData.payloads);
        let currentStream = '';

        const response = await callLLM(
          llmConfig,
          prompt.prompt,
          userPrompt,
          (chunk) => {
            if (!signal.aborted) {
              currentStream += chunk;
              setStreamingContent(currentStream);
              onStatusChange?.('running', { current: i, total: totalSteps }, prompt.name, currentStream, null);
            }
          },
          signal
        );

        if (!signal.aborted) {
          const parsedChecks = parseStructuredChecks(response, prompt.id, prompt.minChecks);
          const result: ReviewResult = {
            promptId,
            promptName: prompt.name,
            response,
            checks: parsedChecks.checks,
            checksExecuted: parsedChecks.checks.length,
            parseWarning: parsedChecks.parseWarning,
            scoreSummary: calculateReviewScoreSummary(parsedChecks.checks),
            timestamp: Date.now(),
          };
          resultsRef.current.push(result);
          onPartialResult?.(result);
        }
      } catch (err) {
        // Check if this was an abort
        if (err instanceof DOMException && err.name === 'AbortError') {
          updateStatus('cancelled', { current: i, total: selectedAnalyses.length }, '', '', null);
          onReviewComplete(resultsRef.current, '');
          return;
        }

        if (!signal.aborted) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          const result: ReviewResult = {
            promptId,
            promptName: prompt.name,
            response: '',
            checks: [],
            checksExecuted: 0,
            scoreSummary: calculateReviewScoreSummary([]),
            error: message,
            timestamp: Date.now(),
          };
          resultsRef.current.push(result);
          onPartialResult?.(result);
        }
      }
    }

    if (!signal.aborted) {
      // Generate executive summary (final step)
      updateStatus('running', { current: selectedAnalyses.length, total: totalSteps }, 'Executive Summary', '', null);

      let executiveSummary = '';
      try {
        const summaryData = resultsRef.current
          .filter(r => !r.error && r.response)
          .map(r => `## ${r.promptName}\n${r.response}`)
          .join('\n\n');

        const boardInfo = analysisResult ?
          `Board: ${analysisResult.summary.copperLayers} layers, ${analysisResult.summary.totalComponents} components, ${analysisResult.summary.totalNets} nets, ${analysisResult.summary.totalVias} vias` : '';

        const userPrompt = `${boardInfo}\n\nProject Description: ${description || 'Not provided'}\n\n# Analysis Results\n\n${summaryData}`;

        executiveSummary = await callLLM(
          llmConfig,
          EXECUTIVE_SUMMARY_PROMPT,
          userPrompt,
          undefined,
          signal
        );
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          console.error('Failed to generate executive summary:', err);
          executiveSummary = 'Executive summary generation failed. Please review the individual analysis sections below.';
        }
      }

      if (!signal.aborted) {
        updateStatus('complete', { current: totalSteps, total: totalSteps }, '', '', null);
        onReviewComplete(resultsRef.current, executiveSummary);
      }
    }
  }, [canRun, selectedAnalyses, llmConfig, buildUserPrompt, onReviewComplete, onPartialResult, updateStatus, onStatusChange, analysisResult, description, analysisDepthMode]);

  const cancelAnalyses = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // Expose cancel function to parent
  if (onCancelRef) {
    onCancelRef.current = cancelAnalyses;
  }

  const needsApiKey = !llmConfig.apiKey.trim();

  const getStatusMessage = (): string => {
    if (needsApiKey) {
      return '';  // Handled separately with clickable link
    }
    if (!analysisResult) {
      return 'Please upload a PCB file first';
    }
    if (selectedAnalyses.length === 0) {
      return 'Please select at least one analysis';
    }
    return '';
  };

  return (
    <div className={styles.container}>
      {(status === 'idle' || status === 'cancelled') && (
        <>
          <button
            className={styles.runButton}
            onClick={runAnalyses}
            disabled={!canRun}
          >
            Run Review ({selectedAnalyses.length} {selectedAnalyses.length === 1 ? 'analysis' : 'analyses'})
          </button>
          {needsApiKey && onOpenSettings && (
            <button
              className={styles.configureLink}
              onClick={onOpenSettings}
            >
              Configure API Key
            </button>
          )}
          {!canRun && !needsApiKey && (
            <p className={styles.statusMessage}>{getStatusMessage()}</p>
          )}
          {promptGuardrailNotice && (
            <p className={styles.guardrailMessage}>{promptGuardrailNotice}</p>
          )}
        </>
      )}


      {status === 'complete' && (
        <div className={styles.complete}>
          <span className={styles.completeIcon}>&#10003;</span>
          <span className={styles.completeText}>Review complete!</span>
          <button
            className={styles.rerunButton}
            onClick={() => setStatus('idle')}
          >
            Run Again
          </button>
        </div>
      )}


      {error && (
        <div className={styles.error}>
          <span className={styles.errorIcon}>&#9888;</span>
          {error}
        </div>
      )}
    </div>
  );
}
