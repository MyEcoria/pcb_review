// Application types

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'ollama_cloud' | 'openai_compatible';
export type Theme = 'auto' | 'light' | 'dark';
export type ReviewStatus = 'idle' | 'running' | 'complete' | 'error' | 'cancelled';

export interface Settings {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  saveApiKey: boolean;
  theme: Theme;
  analysisDepthMode: 'fast' | 'full';
}

export interface LLMConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  organization?: string;
}

export interface UploadedFile {
  file: File;
  content: string | null;
  status: 'pending' | 'parsing' | 'parsed' | 'error';
  error?: string;
}

export interface ReviewResult {
  promptId: string;
  promptName: string;
  response: string;
  checks?: ReviewCheck[];
  checksExecuted?: number;
  parseWarning?: string;
  scoreSummary?: ReviewScoreSummary;
  error?: string;
  timestamp: number;
}

export interface ReviewCheck {
  id: string;
  title: string;
  status: 'pass' | 'fail' | 'warning';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  evidence: string;
  suggestion: string;
  category?: string;
}

export interface ReviewScoreSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  score: number;
}

export interface ScoredReviewResult extends ReviewResult {
  checks: ReviewCheck[];
  scoreSummary: ReviewScoreSummary;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ModelOption {
  id: string;
  name: string;
  contextWindow: number;
}

// Analysis result types matching the browser analyzer output
export interface AnalysisResult {
  projectPath: string;
  timestamp: string;
  summary: {
    totalComponents: number;
    totalNets: number;
    totalTraces: number;
    totalVias: number;
    viaInPadCount: number;
    copperLayers: number;
    schematicSheets: number;
  };
  components: {
    byType: Record<string, unknown[]>;
    all: unknown[];
  };
  powerNets: unknown[];
  signalNets: unknown[];
  traceStats: unknown;
  viaStats: unknown;
  viaInPad: unknown[];
  layerStackup: unknown;
  differentialPairs: unknown[];
  crossReference: unknown;
  thermalAnalysis: unknown[];
}
