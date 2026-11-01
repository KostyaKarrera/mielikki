declare module "@adobe/structured-data-validator" {
  export interface ValidationIssue {
    issueMessage: string;
    severity: "ERROR" | "WARNING";
    rootType?: string;
    fieldNames?: string[];
    path?: unknown[];
    location?: string;
    source?: string;
  }
  export default class Validator {
    constructor(schemaOrgJson: unknown);
    validate(extracted: unknown): Promise<ValidationIssue[]>;
  }
}

declare module "@marbec/web-auto-extractor" {
  export default class WebAutoExtractor {
    constructor(options?: { addLocation?: boolean; embedSource?: string[] });
    parse(html: string): unknown;
  }
}
