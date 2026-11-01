import { type LangModule, tokenizeText } from "./types.js";

export const other: LangModule = {
  code: "other",
  tokenize: tokenizeText,
  stem: (token) => token,
  stopwords: new Set<string>(),
  genericAnchors: [],
  privacyPatterns: [],
};
