export interface Env {
  AI: Ai;
  SCAN_CACHE: KVNamespace;
  SCAN_HISTORY: DurableObjectNamespace;
}

export interface EmailInput {
  subject?: string;
  sender?: string;
  body?: string;
  links?: string[];
}

export interface PhishingIndicator {
  type: string;
  detail: string;
  severity: "low" | "medium" | "high";
}

export interface AnalysisResult {
  score: number;
  verdict: "SAFE" | "SUSPICIOUS" | "DANGEROUS";
  summary: string;
  indicators: PhishingIndicator[];
  recommendations: string[];
  cached?: boolean;
}

export interface ScanHistoryEntry extends AnalysisResult {
  subject: string;
  sender: string;
  timestamp: number;
  id: string;
}
