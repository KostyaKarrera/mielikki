import snowball from "snowball-stemmers";
import { type LangModule, tokenizeText } from "./types.js";

const stemmer = snowball.newStemmer("swedish");

export const sv: LangModule = {
  code: "sv",
  tokenize: tokenizeText,
  stem: (token) => stemmer.stem(token),
  stopwords: new Set(
    "och eller är inte det att när också samt om men som än var vara är var han hon vi ni de vad den detta en ett i på".split(
      " ",
    ),
  ),
  genericAnchors: ["läs mer", "klicka här"],
  privacyPatterns: [/dataskydd|integritet/],
};
