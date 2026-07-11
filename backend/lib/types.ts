export type Severity = "low" | "medium" | "high";
export type Verdict = "SAFE" | "SUSPICIOUS" | "DANGEROUS";

export interface Indicator {
  type: string;
  detail: string;
  severity: Severity;
}

export interface AnalysisResult {
  score: number;
  verdict: Verdict;
  summary: string;
  indicators: Indicator[];
  recommendations: string[];
}

export interface HistoryEntry extends AnalysisResult {
  id: string;
  subject: string;
  sender: string;
  timestamp: number;
}
