import snowball from "snowball-stemmers";
import { type LangModule, tokenizeText } from "./types.js";

const stemmer = snowball.newStemmer("english");

export const en: LangModule = {
  code: "en",
  tokenize: tokenizeText,
  stem: (token) => stemmer.stem(token),
  stopwords: new Set(
    "and or is are not the a an to of in on for with it that this when also if but as be was were he she we you they what which".split(
      " ",
    ),
  ),
  genericAnchors: ["read more", "click here", "here", "more"],
  privacyPatterns: [/privacy/],
};
