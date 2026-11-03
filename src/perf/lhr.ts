/** The readable subset of a Lighthouse report (LHR) that mielikki uses. */
export interface LhrAudit {
  id: string;
  title: string;
  score: number | null;
  numericValue?: number;
  displayValue?: string;
  details?: { type?: string; overallSavingsMs?: number };
}

export interface LhrSubset {
  finalDisplayedUrl: string;
  configSettings: { formFactor: "mobile" | "desktop" };
  categories: { performance: { score: number | null } };
  audits: Record<string, LhrAudit>;
  runWarnings: string[];
  /** Set by Lighthouse when the run produced no usable result (page unreachable, no paint, ...). */
  runtimeError?: { code: string; message: string };
}
