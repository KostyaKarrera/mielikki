export interface LangModule {
  code: "fi" | "sv" | "en" | "other";
  /** Lowercase NFC tokens: letters and digits; hyphens split words. */
  tokenize(text: string): string[];
  stem(token: string): string;
  stopwords: ReadonlySet<string>;
  genericAnchors: readonly string[];
  privacyPatterns: readonly RegExp[];
}

export function tokenizeText(text: string): string[] {
  return (
    text
      .normalize("NFC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}
