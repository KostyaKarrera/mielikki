import snowball from "snowball-stemmers";
import { type LangModule, tokenizeText } from "./types.js";

const stemmer = snowball.newStemmer("finnish");

export const fi: LangModule = {
  code: "fi",
  tokenize: tokenizeText,
  stem: (token) => stemmer.stem(token),
  stopwords: new Set(
    "ja tai on ei se että kun myös sekä jos mutta kuin vai olla ovat oli hän me te he mikä joka tämä tuo".split(
      " ",
    ),
  ),
  genericAnchors: ["lue lisää", "klikkaa tästä", "tästä", "lisää"],
  privacyPatterns: [/tietosuoja/],
};
