export interface ResearchError {
  source: string;
  target: string;
  message: string;
}

export interface DataFile<T> {
  kind: "suggest" | "trends" | "competitors" | "gsc-queries" | "gsc-inspect";
  meta?: {
    generatedAt: string;
    version: string;
    params: Record<string, string | number | boolean>;
  };
  rows: T[];
  errors: ResearchError[];
}
