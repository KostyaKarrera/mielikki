type Lang = "fi" | "sv" | "en" | undefined;

const LATIN = "abcdefghijklmnopqrstuvwxyz".split("");

export function alphabetFor(lang: Lang): string[] {
  if (lang === "fi" || lang === "sv") return [...LATIN, "å", "ä", "ö"];
  return [...LATIN];
}

const TEMPLATES = {
  fi: [
    "miten",
    "mikä",
    "paljonko",
    "kuinka paljon",
    "mitä maksaa",
    "kuka",
    "missä",
  ],
  sv: ["hur", "vad", "vem", "var", "vad kostar"],
  en: ["how", "what", "how much", "who", "where"],
} as const;

export function questionTemplates(lang: Lang): string[] {
  return [...TEMPLATES[lang ?? "en"]];
}
