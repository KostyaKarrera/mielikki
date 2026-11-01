# Mielikki, план 1: ядро и проверка собранного сайта

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mielikki check <dir>` проверяет собранный статический сайт полным набором правил, профили `dev`/`launch`, карта целей с финской морфологией, отчёты text/json/md, плюс `mielikki init` и `mielikki rules`.

**Architecture:** Загрузчик превращает папку сборки в модель сайта (`Site`: страницы, robots, sitemap, граф ссылок). Правила — чистые модули, которые читают модель, конфиг и языковой модуль и сообщают находки. Движок разрешает важность (конфиг → prelaunch → launch), изолирует сбои правил, сортирует находки. Репортеры только форматируют.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), Node ≥ 22; `commander`, `zod`, `yaml`, `cheerio`, `robots-parser`, `fast-xml-parser`, `snowball-stemmers` (ISC), `@adobe/structured-data-validator` (Apache-2.0) + `@marbec/web-auto-extractor` (MIT), `picocolors`; тесты `vitest`; линт и формат `biome`.

**Spec:** `docs/superpowers/specs/2026-11-01-mielikki-design.md`

**Это план 1 из 3.** План 2: URL-режим (обходчик, правила `http/*`) и `perf` (Lighthouse). План 3: `research` (`suggest`, `trends`, `competitors`) и `gsc`, затем релиз 1.0 в npm. Планы 2 и 3 пишутся после выполнения этого, на основе реальных интерфейсов `Site`, `Rule`, `Finding`.

## Global Constraints

- Пакет npm `mielikki`, бинарь `mielikki`, лицензия MIT, копирайт `KostyaKarrera`, репозиторий `github.com/KostyaKarrera/mielikki`.
- Детерминированность: одинаковый вход даёт побайтно одинаковый JSON-отчёт. Без времени, случайности и порядка обхода ФС в выводе (сортировать).
- Никаких сетевых запросов в режиме папки и в тестах. Никакой телеметрии.
- Зависимости только MIT/ISC/BSD/Apache-2.0. Словарь schema.org (CC BY-SA 3.0) хранится в `vendor/` с указанием авторства в `NOTICE`.
- Три уровня важности: `error` | `warning` | `info`. Итоговой оценки нет.
- Коды выхода: `0` нет находок на пороге `--fail-on` (по умолчанию `error`) и выше; `1` есть; `2` ошибка запуска.
- Пороги по умолчанию: title 30–60 символов, description 120–160, глубина ≤ 3 клика, картинки > 200 КБ `info`, > 500 КБ `warning`.
- Правила, перенесённые из claude-seo или squirrelscan, указывают источник в `meta.source`. Общее упоминание — в `NOTICE`.
- Публикация на GitHub и в npm — только после явного подтверждения владельца. Этот план всё делает локально.

## Review Focus

1. **Кривой HTML** (BOM, не-UTF-8 `<meta charset>`, незакрытые теги, верхний регистр, пустой файл) — разбирается мягко, проверка не падает. Тест в задаче 3.
2. **Не-ASCII и закодированные пути** (`/palvelut/sähkö/` и `/palvelut/s%C3%A4hk%C3%B6/`) — одна и та же страница, ссылка не считается битой. Тест в задаче 4.
3. **Варианты адреса одной страницы** (`/a`, `/a/`, `/a.html`, `/a/index.html`, `?x=1`, `#frag`) сводятся к одному ключу. Тест в задаче 4.
4. **Падение одного правила** не роняет проверку: находка `internal/rule-error`, остальные правила работают, код выхода 2 не ставится. Тест в задаче 6.
5. **Ошибка в конфиге** (неверный тип, неизвестный ключ, битый YAML) — код 2 и сообщение с путём к полю, без stack trace. Тест в задаче 2.

---

## Структура файлов

```
package.json  tsconfig.json  biome.json  vitest.config.ts
LICENSE  NOTICE  README.md  .github/workflows/ci.yml  .gitignore
vendor/schemaorg-all-https.jsonld        словарь schema.org (вендорим)
scripts/update-schemaorg.mjs             обновление словаря (ручной запуск)
src/
  cli.ts                                 commander: check, init, rules
  version.ts
  commands/check.ts  commands/init.ts  commands/rules.ts
  config/schema.ts   config/load.ts      zod-схема, загрузка YAML
  model/types.ts                         Site, Page, Link, Img, JsonLdBlock
  model/url.ts                           pageKey, resolveHref
  model/indexable.ts                     isIndexable, isRobotsAllowed
  parse/page.ts                          HTML → Page
  parse/robots.ts  parse/sitemap.ts
  load/dir.ts                            папка → Site, граф ссылок
  lang/types.ts  lang/index.ts  lang/fi.ts  lang/sv.ts  lang/en.ts  lang/other.ts
  lang/match.ts                          stemsMatch, phraseIn
  rules/types.ts  rules/registry.ts  rules/engine.ts  rules/glob.ts
  rules/crawl/*.ts  rules/core/*.ts  rules/links/*.ts  rules/images/*.ts
  rules/social/*.ts rules/i18n/*.ts  rules/content/*.ts rules/schema/*.ts
  rules/local/*.ts  rules/targets/*.ts rules/legal/*.ts rules/a11y/*.ts rules/ai/*.ts
  rules/all.ts                           список всех правил (порядок = порядок id)
  report/text.ts  report/json.ts  report/md.ts
tests/
  helpers.ts                             pageFrom(), siteFrom(), runRule()
  fixtures/sites/{good,broken,prelaunch}/…
  unit/… e2e/…
```

---

### Task 1: Каркас репозитория и CLI

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `NOTICE`, `README.md`, `.github/workflows/ci.yml`, `src/cli.ts`, `src/version.ts`
- Test: `tests/e2e/cli.test.ts`

**Interfaces:**
- Produces: `bin.mielikki = "dist/cli.js"`; скрипты `build` (`tsc -p .`), `test` (`vitest run`), `lint` (`biome check .`), `typecheck` (`tsc --noEmit`); `export const VERSION: string` (из package.json при сборке).

- [ ] **Step 1:** `git init` в `~/Projects/mielikki` (там уже лежат `docs/superpowers/...`), ветка `main`.
- [ ] **Step 2: Тест.** `tests/e2e/cli.test.ts`: запуск собранного `node dist/cli.js --version` печатает `VERSION`, exit 0; `node dist/cli.js nope` → exit 2, stderr содержит `unknown command`.
- [ ] **Step 3:** Запустить `npm test` → FAIL (нет `dist/cli.js`).
- [ ] **Step 4:** Каркас: `package.json` (`"type": "module"`, `"engines": {"node": ">=22"}`, `"files": ["dist","vendor","LICENSE","NOTICE"]`), tsconfig strict + NodeNext + `outDir: dist`, commander с `.exitOverride()`, неизвестная команда даёт код 2. `LICENSE` MIT © 2026 KostyaKarrera. `NOTICE` — разделы «Rules derived from» (claude-seo by AgriciDaniel, MIT; squirrelscan, MIT) и «Bundled data» (schema.org vocabulary, CC BY-SA 3.0). CI: Node 22 и 24, шаги `npm ci`, `lint`, `typecheck`, `build`, `test`. `vitest` запускает e2e после `build` (`globalSetup` вызывает сборку).
- [ ] **Step 5:** `npm run build && npm test` → PASS; `npm run lint && npm run typecheck` → без ошибок.
- [ ] **Step 6:** Commit `chore: scaffold mielikki CLI`.

### Task 2: Конфиг

**Files:**
- Create: `src/config/schema.ts`, `src/config/load.ts`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Produces:
```ts
export type Severity = "error" | "warning" | "info";
export type LangCode = "fi" | "sv" | "en";
export interface TargetPage {
  url: string;
  primary: string;
  secondary: string[];
  forms: Record<string, string[]>;
}
export interface Config {
  site?: string; // абсолютный URL без завершающего слэша
  language?: LangCode; // нет → определяется по <html lang>
  region?: string;
  prelaunch: boolean; // default false
  input: {
    dir: string;
    trailingSlash: "always" | "never" | "ignore";
    cleanUrls: boolean;
  }; // 'dist', 'ignore', true
  business?: {
    type: "brick-and-mortar" | "service-area" | "hybrid";
    schemaType: string;
    name: string;
    phone?: string;
    email?: string;
    areaServed: string[];
    hasReviews: boolean;
  };
  exclude: { noindexExpected: string[]; ignore: string[] }; // маски путей
  placeholders: string[]; // дополняют встроенные ['lorem ipsum','TODO','TBD','PLACEHOLDER']
  testContacts: { phones: string[]; emails: string[] }; // регулярные выражения
  targets: { required: string[]; pages: TargetPage[] };
  rules: {
    enable: string[];
    disable: string[];
    severity: Record<string, Severity>;
    launchBlocking: Record<string, boolean>;
    options: Record<string, Record<string, unknown>>;
  };
}
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  );
}
export function parseConfig(raw: unknown): Config; // бросает ConfigError
export async function loadConfig(
  cwd: string,
  explicitPath?: string,
): Promise<Config>; // mielikki.config.yaml|yml; нет файла → parseConfig({})
```

- Встроенные `testContacts` по умолчанию: phones `['^\\+?0+$', '123 ?456 ?7', '^\\+?358 ?0+$']`, emails `['@example\\.(com|org|net)$', '@test\\.', '^test@']`. Конфиг дополняет их, а не заменяет.

- [ ] **Step 1: Тесты:** `parses spec example` (YAML-пример из спеки §7.6 → `targets.required` = `['/', '/palvelut/*', '/alueet/*']`, `business.hasReviews === false`); `applies defaults` (`{}` → `prelaunch false`, `input.dir 'dist'`, `targets.pages []`); `rejects unknown key` (`{sitee: 'x'}` → `ConfigError` с `path === 'sitee'`); `rejects wrong type with path` (`{targets: {pages: [{url: 5}]}}` → path `targets.pages.0.url`); `bad yaml → ConfigError` (path `''`, сообщение содержит номер строки); `site trailing slash stripped`.
- [ ] **Step 2:** `npx vitest run tests/unit/config.test.ts` → FAIL.
- [ ] **Step 3:** zod-схема со `.strict()` на всех объектах; путь берётся из `issue.path.join('.')`.
- [ ] **Step 4:** Тесты → PASS.
- [ ] **Step 5:** Commit `feat: config schema and loader`.

### Task 3: Модель страницы и разбор HTML

**Files:**
- Create: `src/model/types.ts`, `src/parse/page.ts`
- Test: `tests/unit/parse-page.test.ts`, `tests/helpers.ts`

**Interfaces:**
- Produces:
```ts
export interface Link {
  href: string;
  key?: string;
  internal: boolean;
  text: string;
  rel: string[];
  inChrome: boolean;
}
export interface Img {
  src: string;
  key?: string;
  alt: string | null;
  width?: string;
  height?: string;
  loading?: string;
  inMain: boolean;
  index: number;
}
export interface JsonLdBlock {
  raw: string;
  data?: unknown;
  error?: string;
}
export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}
export interface Page {
  key: string; // pageKey (Task 4), напр. '/palvelut/'
  file?: string; // относительный путь в dist
  status?: number;
  headers?: Record<string, string>; // для URL-режима (план 2)
  html: string;
  lang?: string;
  charset?: string;
  viewport?: string;
  title?: string;
  titleCount: number;
  metaDescription?: string;
  canonical?: string;
  canonicalCount: number;
  robotsMeta: string[]; // нижний регистр, токены
  hreflang: { lang: string; href: string }[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  headings: Heading[];
  mainText: string;
  firstParagraph?: string;
  wordCount: number;
  links: Link[];
  images: Img[];
  jsonld: JsonLdBlock[];
  tel: string[];
  mailto: string[];
  formControls: { tag: string; type?: string; labelled: boolean }[];
  buttons: { named: boolean }[];
}
export function parsePage(html: string, key: string, file?: string): Page;
```

- `mainText`: текст `<main>`, если он есть, иначе `<body>` без `header, nav, footer, script, style, noscript, template`. Пробелы схлопнуты. `inChrome` = ссылка внутри `header|nav|footer`. `firstParagraph` — первый непустой `<p>` в main-области. `labelled` = есть `<label for>`, обёртка `<label>`, `aria-label` или `aria-labelledby`; `hidden`/`submit`/`button` не учитываются. `tel`/`mailto` — значения после схемы, без пробелов.
- `tests/helpers.ts`: `pageFrom(html: string, key = '/'): Page`.

- [ ] **Step 1: Тесты:** `extracts head` (title, description, canonical, robots `['noindex','follow']`, og, twitter, lang `fi`, viewport); `counts duplicates` (два `<title>` → `titleCount 2`); `main text excludes chrome` (текст из `<nav>` отсутствует в `mainText`); `links flagged inChrome`; `jsonld parse error kept` (битый JSON → `error` задан, `raw` сохранён); `tel normalized` (`tel:+358 40 123` → `'+35840123'`); `form labelling`; Review Focus 1: `tolerates bom/uppercase/unclosed/empty` (`'﻿<HTML><BODY><P>x'` и `''` не бросают исключений, `wordCount` ≥ 0).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Реализация на cheerio (`load(html)`), ссылки пока без `key` (его заполняет Task 4).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: html page parser`.

### Task 4: Загрузка папки, URL, robots, sitemap, граф

**Files:**
- Create: `src/model/url.ts`, `src/model/indexable.ts`, `src/parse/robots.ts`, `src/parse/sitemap.ts`, `src/load/dir.ts`
- Test: `tests/unit/url.test.ts`, `tests/unit/load-dir.test.ts`, `tests/unit/robots-sitemap.test.ts`

**Interfaces:**
- Consumes: `parsePage`, `Config`.
- Produces:
```ts
export function pageKey(pathname: string): string; // decodeURI; срезать ?query и #hash; '/x/index.html'|'/x.html'|'/x'|'/x/' → '/x/'; '/' → '/'
export function resolveHref(
  href: string,
  fromKey: string,
  site?: string,
): { internal: boolean; key?: string; external?: string };
// internal: относительный, корневой или абсолютный на host(site); mailto:/tel:/javascript: → internal=false, без key
export interface RobotsInfo {
  raw: string;
  sitemaps: string[];
  isAllowed(path: string, agent: string): boolean;
  disallowsAll(agent: string): boolean;
}
export function parseRobots(raw: string, site?: string): RobotsInfo; // robots-parser
export interface SitemapInfo {
  file: string;
  ok: boolean;
  error?: string;
  urls: string[];
  isIndex: boolean;
}
export function parseSitemap(xml: string, file: string): SitemapInfo; // fast-xml-parser; <urlset>|<sitemapindex>
export interface Asset {
  key: string;
  bytes: number;
  ext: string;
}
export interface Site {
  input: { kind: "dir" | "url"; root: string };
  config: Config;
  site?: string; // базовый URL
  pages: Page[]; // отсортированы по key; без 404
  notFound?: Page;
  robots?: RobotsInfo;
  sitemaps: SitemapInfo[];
  assets: Map<string, Asset>; // все не-HTML файлы, key = '/img/a.jpg' (decodeURI)
  byKey: Map<string, Page>;
  inlinks: Map<string, string[]>; // key → ключи страниц, ссылающихся из контента (не inChrome)
  inlinksAll: Map<string, string[]>; // включая inChrome
  depth: Map<string, number>; // BFS от '/' по всем внутренним ссылкам
}
export async function loadDir(dir: string, config: Config): Promise<Site>;
export function isRobotsAllowed(
  site: Site,
  key: string,
  agent?: string,
): boolean; // agent default 'Googlebot'
export function isIndexable(site: Site, page: Page): boolean;
```

- `isIndexable` = ключ не попадает под `exclude.noindexExpected` и `exclude.ignore`, canonical отсутствует или указывает на собственный ключ. Плюс, если `config.prelaunch` ложно: нет `noindex` в `robotsMeta` и `isRobotsAllowed`. При `prelaunch: true` закрытость не учитывается: проверяем страницы, которые будут индексироваться после запуска.
- `site` берётся из `config.site`, иначе из host самого частого абсолютного canonical, иначе `undefined`.
- Sitemap: файлы из `robots.sitemaps` (путь берётся из URL), иначе `/sitemap.xml`, `/sitemap-index.xml`, `/sitemap_index.xml`. Индекс раскрывается рекурсивно, только локальные файлы.
- `404.html` в корне → `notFound`. Порядок обхода ФС сортируется.
- `tests/helpers.ts` дополняется: `siteFrom(files: Record<string, string | Buffer>, config?: Partial<Config>): Promise<Site>` (пишет во временную папку и вызывает `loadDir`).

- [ ] **Step 1: Тесты:** `pageKey variants` (Review Focus 3: `/a`, `/a/`, `/a.html`, `/a/index.html`, `/a/?x=1#h` → `/a/`); `non-ascii keys` (Review Focus 2: `/palvelut/s%C3%A4hk%C3%B6/` и `/palvelut/sähkö/` → один ключ; ссылка между ними даёт найденную страницу); `resolveHref absolute same host internal`; `robots disallow all` (`User-agent: *\nDisallow: /` → `disallowsAll('Googlebot')`); `sitemap index expands`; `sitemap invalid xml → ok false`; `graph depth and inlinks` (`/` → `/a/` → `/b/`: depth `/b/` = 2, inlinks `/b/` = `['/a/']`; ссылка из `<nav>` есть только в `inlinksAll`); `prelaunch indexable` (страница с `noindex` и `prelaunch: true` → `isIndexable` true; без prelaunch → false); `404 separated`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Реализация.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: load built site from directory`.

### Task 5: Языковые модули и сопоставление запросов

**Files:**
- Create: `src/lang/types.ts`, `src/lang/index.ts`, `src/lang/fi.ts`, `src/lang/sv.ts`, `src/lang/en.ts`, `src/lang/other.ts`, `src/lang/match.ts`
- Test: `tests/unit/lang-fi.test.ts`, `tests/unit/match.test.ts`

**Interfaces:**
- Produces:
```ts
export interface LangModule {
  code: "fi" | "sv" | "en" | "other";
  tokenize(text: string): string[]; // нижний регистр, NFC, буквы+цифры с дефисом внутри слова разбиваются ('itä-uusimaa' → ['itä','uusimaa'])
  stem(token: string): string; // other → identity
  stopwords: ReadonlySet<string>;
  genericAnchors: readonly string[]; // fi: 'lue lisää','klikkaa tästä','tästä','lisää'; sv: 'läs mer','klicka här'; en: 'read more','click here','here','more'
  privacyPatterns: readonly RegExp[]; // fi: /tietosuoja/; sv: /dataskydd|integritet/; en: /privacy/
}
export function getLang(code?: string): LangModule; // 'fi-FI' → fi; неизвестный → other
export type MatchLevel = "full" | "partial" | "none";
export function stemsMatch(a: string, b: string): boolean;
export function phraseIn(
  phrase: string,
  text: string,
  lang: LangModule,
  forms?: Record<string, string[]>,
): MatchLevel;
```

- Алгоритм `stemsMatch` (на него опираются все проверки целей):
```ts
// равны, ИЛИ общий префикс >= max(5, min(a.length, b.length) - 2)
// (проверено: helsink/helsing, sähköasennus/sähköasennuks — совпадают; asennus/asentaj — нет)
```

- `phraseIn`: токены фразы без стоп-слов. Для каждого токена фразы: `match`, если какой-нибудь токен текста даёт `stemsMatch` по основам или совпадает с явной формой из `forms[token]`; `compound`, если основа токена текста длиной ≥ 5 заканчивается основой токена фразы или начинается с неё; иначе `miss`. Все `match` → `full`; нет `miss` → `partial`; доля `miss` ≤ 1/2 → `partial`; иначе `none`.

- [ ] **Step 1: Тесты (fi):** `Loviisa ~ Loviisassa/Loviisan` (full); `Porvoo ~ Porvoossa`; `Helsinki ~ Helsingissä` (full за счёт префикса); `sähköasennus ~ sähköasennukset` (full); `asentaja в sähköasentajan` (partial, compound); `asennus vs asentaja` (`stemsMatch` false); `forms override` (`forms: {kotka: ['kotkassa']}`); `stopwords ignored` (`sähköasentaja ja loviisa` против текста без «ja» → full); `itä-uusimaa tokenized`; `phrase none`. Тесты sv и en: по 2 теста (`Lovisa ~ i Lovisa`, `electrician ~ electricians`).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Snowball через `snowball-stemmers` (`newStemmer('finnish'|'swedish'|'english')`), стоп-слова — короткие списки в файлах модулей (fi: ja, tai, on, ei, se, että, kun, myös, sekä, jos, mutta, kuin, tai, vai, olla, ovat, oli, hän, me, te, he, mikä, joka, tämä, tuo; sv и en — аналогичные списки по 20–30 слов).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: language modules and phrase matching`.

### Task 6: Движок правил

**Files:**
- Create: `src/rules/types.ts`, `src/rules/registry.ts`, `src/rules/engine.ts`, `src/rules/glob.ts`, `src/rules/all.ts` (пока пустой массив)
- Test: `tests/unit/engine.test.ts`; дополнить `tests/helpers.ts`

**Interfaces:**
- Consumes: `Site`, `Config`, `LangModule`.
- Produces:
```ts
export type Profile = "dev" | "launch";
export interface RuleMeta {
  id: string;
  title: string;
  category: string;
  severity: Severity; // базовая
  scope: "page" | "site";
  inputs: ("dir" | "url")[];
  launchBlocking: boolean; // в launch → error
  prelaunchExpected?: boolean; // в dev при config.prelaunch → info
  fix: string;
  source: string; // URL документации или 'claude-seo:<path>' / 'squirrelscan:<rule-id>'
  defaultOff?: boolean;
}
export interface Finding {
  ruleId: string;
  severity: Severity;
  url?: string;
  message: string;
  fix: string;
  details?: Record<string, unknown>;
}
export interface Report {
  message: string;
  url?: string;
  severity?: Severity;
  details?: Record<string, unknown>;
}
export interface RuleContext {
  site: Site;
  config: Config;
  lang: LangModule;
  profile: Profile;
  options<T>(defaults: T): T; // слияние config.rules.options[rule.id] поверх defaults
  report(r: Report): void;
}
export interface PageRule {
  meta: RuleMeta & { scope: "page" };
  checkPage(page: Page, ctx: RuleContext): void | Promise<void>;
}
export interface SiteRule {
  meta: RuleMeta & { scope: "site" };
  checkSite(ctx: RuleContext): void | Promise<void>;
}
export type Rule = PageRule | SiteRule;
export function matchGlob(pattern: string, value: string): boolean; // '*' — один сегмент/часть id, '**' — что угодно; для id и путей
export function selectRules(
  all: Rule[],
  config: Config,
  include?: string[],
): Rule[];
export function resolveSeverity(
  base: Severity,
  meta: RuleMeta,
  config: Config,
  profile: Profile,
): Severity;
export async function runRules(
  site: Site,
  rules: Rule[],
  config: Config,
  profile: Profile,
): Promise<Finding[]>;
```

- `resolveSeverity`, порядок: `base` (из `Report.severity` или `meta.severity`) → `config.rules.severity[id]` → если `profile==='dev' && config.prelaunch && meta.prelaunchExpected` → `info` → если `profile==='launch' && (config.rules.launchBlocking[id] ?? meta.launchBlocking)` и итог не `info` → `error`.
- Page-правила не запускаются для страниц под `exclude.ignore`. Исключение в правиле → находка `{ruleId: 'internal/rule-error', severity: 'warning', message: '<rule id>: <error.message>'}`.
- Сортировка находок: важность (`error`, `warning`, `info`), затем `ruleId`, затем `url`, затем `message`.
- `selectRules`: по умолчанию все, кроме `defaultOff`; `rules.enable` добавляет, `rules.disable` исключает (маски), `include` (флаг `--rules`) заменяет набор.
- `tests/helpers.ts`: `runRule(rule: Rule, site: Site, profile?: Profile): Promise<Finding[]>`.

- [ ] **Step 1: Тесты:** `severity override from config`; `prelaunch downgrades expected rules in dev`; `launch escalates blocking warning to error`; `launch keeps info as info`; `config launchBlocking=false disables escalation`; `sorted deterministically` (два запуска → одинаковый JSON); `ignore excludes pages`; `disable mask 'links/*'`; Review Focus 4: `rule crash isolated` (правило бросает исключение → есть `internal/rule-error`, находки второго правила на месте).
- [ ] **Step 2:** FAIL. **Step 3:** реализация. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: rule engine`.

### Task 7: Отчёты и команды `check`, `rules`

**Files:**
- Create: `src/report/text.ts`, `src/report/json.ts`, `src/report/md.ts`, `src/commands/check.ts`, `src/commands/rules.ts`; Modify: `src/cli.ts`
- Test: `tests/unit/report.test.ts`, `tests/e2e/check.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `loadDir`, `getLang`, `selectRules`, `runRules`, `allRules` из `src/rules/all.ts`.
- Produces:
```ts
export interface CheckResult {
  schemaVersion: 1;
  tool: { name: "mielikki"; version: string };
  input: { kind: "dir" | "url"; root: string };
  profile: Profile;
  language: string;
  summary: { pages: number; error: number; warning: number; info: number };
  findings: Finding[];
}
export function renderText(
  r: CheckResult,
  opts: { color: boolean; minSeverity: Severity },
): string;
export function renderJson(r: CheckResult): string; // JSON.stringify(r, null, 2) + '\n'
export function renderMarkdown(r: CheckResult): string; // таблица сводки + разделы по важности
export function exitCodeFor(r: CheckResult, failOn: Severity): 0 | 1;
```

- CLI: `mielikki check [dir] --config <path> --profile dev|launch --format text|json|md --output <file> --fail-on error|warning|info --rules <mask,…> --min-severity <s>` (`dir` по умолчанию `config.input.dir`). `root` в отчёте — путь относительно cwd. Язык: `config.language` → самый частый `lang` страниц → `other`. Ошибки запуска (`ConfigError`, папки нет, в папке нет HTML) → stderr одной строкой, код 2.
- `mielikki rules [--format text|json|md]` — таблица id, важность, blocking, область, источник; `mielikki rules explain <id>` — title, fix, source, опции по умолчанию. Неизвестный id → код 2.
- Текст: заголовок с числом страниц, затем группы по важности, находки сгруппированы по правилу (`ruleId — title`, список url: message, одна строка `→ fix`). Цвета через picocolors и только при TTY.

- [ ] **Step 1: Тесты:** `json stable` (снимок `renderJson` для фиктивного `CheckResult`); `exit code by fail-on`; `md contains summary table`; e2e: `check on empty dir → exit 2`; `check --format json parses` (временная папка с одной страницей → валидный JSON, `schemaVersion 1`); `rules explain unknown → exit 2`; Review Focus 5: `bad config → exit 2, stderr has field path`.
- [ ] **Step 2:** FAIL. **Step 3:** реализация. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: check and rules commands with reporters`.

---

**Правила (задачи 8–15).** В каждой задаче: один файл на правило (`src/rules/<cat>/<name>.ts`, экспорт `rule`), регистрация в `src/rules/all.ts` (сортировка по id), тесты в `tests/unit/rules/<cat>.test.ts` через `pageFrom` / `siteFrom` / `runRule`: минимум «срабатывает» и «не срабатывает» на каждое правило плюс отдельные тесты из таблиц. В колонке «Б» — `launchBlocking`, в «P» — `prelaunchExpected`. Текст `fix` пишется на английском (интерфейс CLI на английском), коротко и по делу. Шаги одинаковые: тесты → FAIL → реализация → PASS → commit `feat(rules): <category>`.

### Task 8: Правила `crawl`

| id                               | Обл. | Важн.   | Б   | P   | Срабатывает, когда                                                                      |
| -------------------------------- | ---- | ------- | --- | --- | --------------------------------------------------------------------------------------- |
| `crawl/robots-missing`           | site | error   | ✓   | ✓   | нет `/robots.txt`                                                                       |
| `crawl/robots-blocks-all`        | site | error   | ✓   | ✓   | `disallowsAll('Googlebot')`                                                             |
| `crawl/robots-blocks-page`       | site | error   | ✓   | ✓   | индексируемая страница запрещена для Googlebot (если не blocks-all)                     |
| `crawl/robots-blocks-assets`     | site | warning |     |     | запрещены пути `.css`/`.js`/картинок, которые используются страницами                   |
| `crawl/robots-no-sitemap`        | site | warning |     | ✓   | robots есть, строки `Sitemap:` нет                                                      |
| `crawl/sitemap-missing`          | site | error   | ✓   | ✓   | ни одного sitemap не найдено                                                            |
| `crawl/sitemap-invalid`          | site | error   | ✓   |     | `SitemapInfo.ok === false` или 0 URL                                                    |
| `crawl/sitemap-foreign-host`     | site | error   | ✓   |     | host URL в sitemap или в строке `Sitemap:` ≠ host `site.site` (ловит localhost/staging) |
| `crawl/sitemap-missing-page`     | site | warning |     |     | индексируемая страница отсутствует в sitemap                                            |
| `crawl/sitemap-bad-entry`        | site | warning |     |     | URL из sitemap: страницы нет, она неиндексируемая или canonical указывает на другую     |
| `crawl/noindex`                  | page | error   | ✓   | ✓   | `noindex` на странице не из `noindexExpected`                                           |
| `crawl/noindex-expected-missing` | page | warning |     |     | страница из `noindexExpected` без `noindex`                                             |
| `crawl/depth`                    | site | warning |     |     | индексируемая страница с `depth > 3` (опция `maxDepth`: 3)                              |
| `crawl/orphan`                   | site | warning |     |     | индексируемая страница (кроме `/`) без `inlinksAll`                                     |
| `crawl/canonical-target`         | page | error   | ✓   |     | canonical ведёт на внутренний ключ, которого нет, или на неиндексируемую страницу       |
| `crawl/thin-html`                | page | warning |     |     | `wordCount < 30` и есть `<script>` — признак рендеринга на клиенте                      |

- Тест `prelaunch site in dev has only info for P rules` на фикстуре: `robots Disallow: /` + `noindex` на всех страницах + `prelaunch: true`.

### Task 9: Правила `core` и `mobile`

| id                               | Обл. | Важн.   | Б   | Срабатывает, когда                                                   |
| -------------------------------- | ---- | ------- | --- | -------------------------------------------------------------------- |
| `core/title-missing`             | page | error   | ✓   | нет `title` или он пустой                                            |
| `core/title-multiple`            | page | warning |     | `titleCount > 1`                                                     |
| `core/title-length`              | page | warning |     | длина вне `[30, 60]` (опции `min`, `max`)                            |
| `core/title-duplicate`           | site | warning |     | одинаковый title у ≥ 2 индексируемых страниц                         |
| `core/description-missing`       | page | warning |     | нет description                                                      |
| `core/description-length`        | page | info    |     | длина вне `[120, 160]`                                               |
| `core/description-duplicate`     | site | warning |     | одинаковые description                                               |
| `core/description-repeats-title` | page | info    |     | description начинается с текста title (без учёта регистра)           |
| `core/h1-missing`                | page | error   | ✓   | нет H1                                                               |
| `core/h1-multiple`               | page | warning |     | H1 > 1                                                               |
| `core/heading-skip`              | page | info    |     | скачок уровня больше чем на 1 (H2 → H4)                              |
| `core/canonical-missing`         | page | warning |     | нет canonical на индексируемой странице                              |
| `core/canonical-invalid`         | page | error   | ✓   | `canonicalCount > 1`, относительный canonical или host ≠ `site.site` |
| `core/lang-missing`              | page | warning |     | нет `lang`                                                           |
| `core/lang-mismatch`             | page | warning |     | основной язык `lang` ≠ языку проверки                                |
| `core/charset-missing`           | page | info    |     | нет charset                                                          |
| `mobile/viewport-missing`        | page | warning |     | нет `viewport`                                                       |
| `mobile/zoom-disabled`           | page | warning |     | `user-scalable=no` или `maximum-scale < 2`                           |

- Правила `core/*` по title и description применяются только к индексируемым страницам.

### Task 10: Правила `links`, `images`, `social`, `i18n`

| id                        | Обл. | Важн.   | Б   | Срабатывает, когда                                                                             |
| ------------------------- | ---- | ------- | --- | ---------------------------------------------------------------------------------------------- |
| `links/broken-internal`   | page | error   | ✓   | внутренний `key` не найден ни среди страниц, ни среди `assets`                                 |
| `links/empty-anchor`      | page | warning |     | нет текста, `aria-label` и `alt` у вложенной картинки                                          |
| `links/generic-anchor`    | page | info    |     | текст ссылки ∈ `lang.genericAnchors`                                                           |
| `links/dead-end`          | site | info    |     | у индексируемой страницы нет внутренних ссылок из контента                                     |
| `links/insecure-external` | page | info    |     | внешний `http://`                                                                              |
| `links/trailing-slash`    | page | info    |     | форма ссылки противоречит `input.trailingSlash` ('always'/'never')                             |
| `images/broken`           | page | error   | ✓   | внутренний `src` не найден в `assets`                                                          |
| `images/alt-missing`      | page | warning |     | нет атрибута `alt` (пустой `alt=""` допустим)                                                  |
| `images/dimensions`       | page | info    |     | нет `width` или `height`                                                                       |
| `images/weight`           | page | warning |     | > 500 КБ (`warning`), > 200 КБ (`info`, через `Report.severity`)                               |
| `images/modern-format`    | page | info    |     | `.jpg/.jpeg/.png` > 50 КБ                                                                      |
| `images/lazy-above-fold`  | page | info    |     | у первой картинки в main (`index === 0 && inMain`) `loading="lazy"`                            |
| `social/og-missing`       | page | warning |     | на индексируемой странице нет хотя бы одного из `og:title`, `og:description`, `og:image`       |
| `social/og-image-broken`  | page | warning |     | внутренний `og:image` не найден в `assets`                                                     |
| `social/og-url-mismatch`  | page | info    |     | `og:url` ≠ canonical                                                                           |
| `social/twitter-card`     | page | info    |     | нет `twitter:card`                                                                             |
| `i18n/hreflang`           | page | warning |     | код языка не BCP 47, целевой страницы нет, нет обратной ссылки, нет `x-default` при ≥ 2 языках |

### Task 11: Правила `content`

| id                         | Обл. | Важн.   | Б   | Срабатывает, когда                                                                                                                                    |
| -------------------------- | ---- | ------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content/placeholder`      | page | error   | ✓   | любая строка из встроенных и `config.placeholders` (без учёта регистра, по границам слов) в title, description, mainText, alt, `og:*`                 |
| `content/test-contact`     | page | error   | ✓   | значение `tel`/`mailto` или телефон или email в тексте подходит под `testContacts`, либо `tel` ≠ `business.phone` (после нормализации), если он задан |
| `content/word-count`       | page | info    |     | у индексируемой страницы `wordCount < minWords` (опция `minWords`: 250; для `targets.required`: 400)                                                  |
| `content/near-duplicate`   | site | warning |     | Jaccard по 5-словным шинглам mainText ≥ 0.9 у двух индексируемых страниц                                                                              |
| `content/keyword-stuffing` | page | warning |     | на странице с целью какая-то основа из `primary` > 4 % токенов mainText и встречается ≥ 8 раз                                                         |

### Task 12: Правила `schema`

**Files (дополнительно):** `vendor/schemaorg-all-https.jsonld`, `scripts/update-schemaorg.mjs` (скачивает `https://schema.org/version/latest/schemaorg-all-https.jsonld`), `src/rules/schema/vocab.ts` (ленивая загрузка из `vendor/` через `new URL('../../../vendor/…', import.meta.url)`, один раз на запуск).

| id                             | Обл. | Важн.   | Б   | Срабатывает, когда                                                                                                                           |
| ------------------------------ | ---- | ------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema/jsonld-syntax`         | page | error   | ✓   | у `JsonLdBlock` есть `error`                                                                                                                 |
| `schema/validation`            | page | warning |     | issue валидатора Adobe: `ERROR` → `Report.severity: 'error'`; `WARNING` → `warning`; `WARNING`, в тексте которого есть `(optional)` → `info` |
| `schema/business-missing`      | site | error   | ✓   | `business` задан, но на `/` нет узла с `@type` = `business.schemaType` (поиск по `@graph` и вложенным)                                       |
| `schema/business-generic-type` | site | warning |     | на сайте есть `LocalBusiness`/`Organization`, а в конфиге задан более точный `schemaType`                                                    |
| `schema/nap-mismatch`          | site | error   | ✓   | `name`/`telephone` бизнес-узла ≠ `business.name`/`business.phone` (телефон сравнивается в нормализованном виде)                              |
| `schema/area-served`           | site | warning |     | `business.type` ∈ {service-area, hybrid}, а `areaServed` у бизнес-узла нет                                                                   |
| `schema/fake-rating`           | page | error   | ✓   | `aggregateRating` или `review` в любом узле при `business.hasReviews !== true`                                                               |
| `schema/identity`              | site | warning |     | бизнес-узлы на разных страницах с разными `@id` или разными `name`                                                                           |
| `schema/deprecated`            | page | info    |     | `HowTo`; `FAQPage` («rich results для FAQ сняты, разметка допустима»)                                                                        |

- Валидатор: `import Validator from '@adobe/structured-data-validator'` (default export); вход — результат `new WebAutoExtractor({ addLocation: true, embedSource: ['rdfa', 'microdata'] }).parse(page.html)`; `await new Validator(vocab).validate(extracted)` возвращает issues с полями `issueMessage`, `severity`, `rootType`, `fieldNames`. Проверено вручную 2026-11-01 на `Electrician` с неполным `aggregateRating`: ERROR про `ratingCount|reviewCount`.
- У `schema/validation` `meta.launchBlocking: false`: ошибки валидатора и так приходят как `error`, а его предупреждения в launch не повышаются, чтобы не создавать шума.
- В тесте `broken: every launchBlocking rule fires` (Task 17) правило `schema/validation` не требуется. Его покрывает отдельный тест с неполным `aggregateRating`, где ожидается `error`.

### Task 13: Правила `local`

| id                        | Обл. | Важн.   | Б   | Срабатывает, когда                                                                                                                                                                                                                              |
| ------------------------- | ---- | ------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local/phone-consistency` | site | warning |     | на страницах встречаются ≥ 2 разных нормализованных `tel`                                                                                                                                                                                       |
| `local/tel-link`          | page | warning |     | `business.phone` встречается в mainText или в подвале, но на странице нет ни одного `tel:`                                                                                                                                                      |
| `local/name-consistency`  | site | info    |     | `business.name` не встречается в тексте ни одной страницы                                                                                                                                                                                       |
| `local/swap-test`         | site | warning |     | для страниц под опцией `pages` (по умолчанию `['/alueet/*']`) каждое вхождение любого `areaServed` (по `stemsMatch` и явным формам из целей) заменяется на `{CITY}`; Jaccard 5-словных шинглов двух страниц ≥ 0.6 → шаблонные страницы регионов |

- Тест swap test: две страницы, отличающиеся только «Loviisassa»/«Porvoossa» → находка; две страницы с разным содержанием → нет.

### Task 14: Правила `targets`

| id                               | Обл. | Важн.   | Б   | P   | Срабатывает, когда                                                                                                                                                                       |
| -------------------------------- | ---- | ------- | --- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `targets/page-missing`           | site | error   | ✓   |     | страницы для `url` из цели нет                                                                                                                                                           |
| `targets/not-indexable`          | site | error   | ✓   | ✓   | страница цели неиндексируемая; при prelaunch учитывать реальное закрытие (noindex/robots)                                                                                                |
| `targets/primary-in-title`       | site | error   | ✓   |     | `phraseIn(primary, title)` = `none` → error; `partial` → `warning`                                                                                                                       |
| `targets/primary-in-h1`          | site | error   | ✓   |     | то же для текста первого H1                                                                                                                                                              |
| `targets/primary-in-intro`       | site | warning |     |     | `none` в `firstParagraph`                                                                                                                                                                |
| `targets/primary-in-description` | site | warning |     |     | `none` в description                                                                                                                                                                     |
| `targets/secondary-in-text`      | site | info    |     |     | `none` в mainText для каждого secondary (одна находка на фразу)                                                                                                                          |
| `targets/cannibalization`        | site | error   | ✓   |     | у двух целей множества основ `primary` (без стоп-слов) совпадают по `stemsMatch` без учёта порядка                                                                                       |
| `targets/missing-target`         | site | warning | ✓   |     | индексируемая страница под `targets.required` без цели → `warning` (в launch → error); индексируемая страница вне `required` без цели → `info`; если `required` пуст, есть только `info` |

- Ключи `url` целей нормализуются через `pageKey`. Тесты на финских фразах из спеки: `/palvelut/sahkoasennukset/` с title «Sähköasennukset Loviisassa | Example» → нет находки по title; две цели «sähköasentaja loviisa» и «loviisan sähköasentaja» → каннибализация.

### Task 15: Правила `legal`, `a11y`, `ai`

| id                     | Обл. | Важн.   | Б   | Срабатывает, когда                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ---- | ------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `legal/privacy-policy` | site | warning | ✓   | нет внутренней ссылки, у которой текст или путь подходит под `lang.privacyPatterns` (опция `path` задаёт путь явно); blocking, потому что сайт в ЕС с формами                                                                                                                                                                                                                                                            |
| `legal/contact-page`   | site | info    |     | нет страницы или ссылки с путём или текстом `yhteystiedot\|kontakt\|contact`                                                                                                                                                                                                                                                                                                                                             |
| `a11y/form-label`      | page | warning |     | есть элемент формы с `labelled === false`                                                                                                                                                                                                                                                                                                                                                                                |
| `a11y/button-name`     | page | warning |     | есть кнопка без доступного имени                                                                                                                                                                                                                                                                                                                                                                                         |
| `ai/crawler-access`    | site | info    |     | для каждого токена из списка сообщается, разрешён ли `/` в robots: `GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Google-Extended, Applebot-Extended, Bytespider, CCBot`. Одна находка `info` со сводкой в `details`; `warning`, если закрыт хотя бы один поисковый (`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`) — с явным `User-agent`, а не через blocks-all |

- `source` для `ai/crawler-access`: `claude-seo:skills/seo-technical/SKILL.md`; контраст в `a11y` не проверяем (статически ненадёжно, мой выбор по спеке «по возможности»).

### Task 16: Команда `init`

**Files:** Create `src/commands/init.ts`; Modify `src/cli.ts`. Test: `tests/e2e/init.test.ts`.

**Interfaces:**
- Consumes: `loadDir`, `parseConfig`.
- Produces: `mielikki init [dir] --site <url> --language <fi|sv|en> --business-type <…> --schema-type <Type> --force` → пишет `mielikki.config.yaml` в cwd. Если файл есть и нет `--force` → код 2.

- Автоопределение по сборке: `language` (самый частый `lang`), `site` (host самого частого абсолютного canonical), `business.schemaType` и `name` (из первого бизнес-узла JSON-LD на `/`), `exclude.noindexExpected` (страницы, которые сейчас с `noindex`, если не все страницы с ним). `targets: {required: ['/'], pages: []}`. Файл с комментариями-подсказками к каждому разделу; итоговый YAML проходит `parseConfig`.

- [ ] **Step 1: Тесты:** `generates valid config` (`parseConfig(yaml.parse(file))` не бросает; язык и site определены по фикстуре); `refuses overwrite`; `--force overwrites`.
- [ ] **Steps 2–5:** FAIL → реализация → PASS → commit `feat: init command`.

### Task 17: Фикстуры сайтов, эталонные отчёты, документация

**Files:**
- Create: `tests/fixtures/sites/good/**` (5–6 страниц на финском: `/`, `/palvelut/`, `/palvelut/sahkoasennukset/`, `/alueet/`, `/yhteystiedot/`, `/tietosuojaseloste/`, `/kiitos/`, `404.html`, robots, sitemap, `Electrician` JSON-LD, конфиг с целями), `tests/fixtures/sites/broken/**` (по одному нарушению на каждое правило с `launchBlocking`), `tests/fixtures/sites/prelaunch/**` (good + `Disallow: /` + `noindex` + `prelaunch: true`); `tests/e2e/fixtures.test.ts`; `tests/e2e/__snapshots__/*`; `README.md`; `docs/rules.md` (генерируется `mielikki rules --format md`).

- [ ] **Step 1: Тесты:** `good: no error/warning in dev and launch`; `broken: every launchBlocking rule fires` (множество `ruleId` с `severity==='error'` в launch ⊇ множества правил с `launchBlocking`); `prelaunch: dev exits 0, launch exits 1`; `json report snapshot` для broken (детерминированность); `docs/rules.md up to date` (сравнение с выводом `rules --format md`).
- [ ] **Step 2:** FAIL. **Step 3:** фикстуры и README (англ.): установка, быстрый старт, конфиг (пример из спеки), профили, коды выхода, связка с Claude Code (`--format json`), ссылки на источники. **Step 4:** PASS.
- [ ] **Step 5:** Commit `test: fixture sites and docs`.
- [ ] **Step 6:** Показать владельцу итог и спросить разрешения создать публичный репозиторий `KostyaKarrera/mielikki` и сделать push. Без подтверждения не публиковать.

---

## После плана 1

- Подключение к первому сайту (`site`: `mielikki.config.yaml`, шаг в CI, сборка с боевыми настройками для `launch`) — отдельная задача в хабе после публикации репозитория. Пакет ставится из git (`github:KostyaKarrera/mielikki`) до релиза в npm.
- План 2: URL-режим и `perf`. План 3: `research`, `gsc`, релиз 1.0.
