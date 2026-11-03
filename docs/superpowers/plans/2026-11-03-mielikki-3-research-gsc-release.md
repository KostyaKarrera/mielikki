# Mielikki, план 3: `research`, `gsc` и релиз 1.0

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить сбор сырья для подбора запросов (`research suggest`, `research trends`, `research competitors`) и Search Console (`gsc auth`, `gsc inspect`, `gsc queries`), довести пакет до версии 1.0.0, готовой к публикации в npm (сама публикация только по явному подтверждению владельца).

**Architecture:** Каждая команда — тонкая обёртка в `src/commands/` над чистым модулем в `src/research/` или `src/gsc/`. Сеть идёт только через инжектируемые интерфейсы (`Fetcher` из плана 2 для обхода; узкий `HttpJson` для Google API), поэтому все тесты работают на записанных ответах и loopback-сервере. Общие части: дисковый кэш (`src/research/cache.ts`), запись данных в JSON/CSV/MD (`src/research/output.ts`). Источник Trends неофициальный и изолирован: его сбой даёт понятную ошибку только этой команде.

**Tech Stack:** тот же (Node ≥ 22.12, TS strict ESM, commander, zod, cheerio). **Новых зависимостей нет:** подсказки, Trends и Search Console работают на встроенном `fetch`; OAuth — PKCE с loopback-редиректом на `node:http`.

**Spec:** `docs/superpowers/specs/2026-11-01-mielikki-design.md` (разделы 2, 4, 5, 6, 9 «research» и «gsc», 10, 12, 13 «Search Console»)

**Это план 3 из 3.** Предыдущие: `2026-11-01-mielikki-1-core-check.md`, `2026-11-02-mielikki-2-url-mode-perf.md` (ветка `feat/plan-2-url-perf`; план 3 делается от неё, если она ещё не влита в `main`).

## Global Constraints

- **Сеть только по явному вызову:** `research *` ходит только к `suggestqueries.google.com`, `trends.google.com` и к URL, переданным в `competitors`; `gsc *` — только к `accounts.google.com`, `oauth2.googleapis.com`, `searchconsole.googleapis.com`, `www.googleapis.com`. `check` и `perf` не затрагиваются. Без телеметрии, без cookies сверх необходимых Trends.
- **Приватность токенов:** токен Search Console хранится только в `$XDG_CONFIG_HOME/mielikki/gsc-token.json` (иначе `~/.config/mielikki/…`), права файла `0600`, каталог `0700`. Токены, `client_secret`, `refresh_token` и `code` **никогда** не попадают в stdout, stderr, отчёты, кэш и сообщения об ошибках. Путь к OAuth-клиенту в проект не записывается.
- **Только чтение:** единственный scope — `https://www.googleapis.com/auth/webmasters.readonly`.
- **Вежливость:** `suggest` — не больше 1 запроса в 400 мс (флаг `--delay`), `competitors` — `--delay 500`, `--concurrency 1`, `--max-pages 30`, robots.txt чужого сайта **соблюдается всегда** (без флага отключения), агент `Mielikki/<версия> (+https://github.com/KostyaKarrera/mielikki)`. Содержимое чужих сайтов — недоверенные данные: ограничения Fetcher из плана 2 (размер, таймаут, число редиректов) действуют; на сторонние хосты обход не уходит.
- **Детерминизм:** при одинаковых ответах источников файлы данных побайтно одинаковы: сортировка, в файле нет времени запроса (время и версия — только в отдельном поле `meta.generatedAt`, которое можно отключить `--no-meta`; тесты используют `--no-meta`). Порядок завершения запросов на результат не влияет.
- **Отказоустойчивость (антицель №6):** сбой одного запроса подсказок/одной страницы конкурента не отбрасывает остальные результаты: ошибка записывается в `errors[]` файла данных, код выхода 0, если получен хотя бы один результат; если не получено ничего — код 1 (источник недоступен) с понятным сообщением. Код 2 — только ошибки использования и конфига.
- **Кэш:** `<cwd>/.mielikki/cache/`, ключ — хэш (источник, параметры запроса), TTL 7 дней, `--refresh` игнорирует кэш, `--no-cache` не читает и не пишет. Повреждённый файл кэша = промах, а не падение. `.gitignore` проекта не изменяется; README советует добавить `.mielikki/`, а `init` печатает этот совет.
- Языки и алфавит для расширения основы: `fi` — a–z, å, ä, ö; `sv` — a–z, å, ä, ö; `en` — a–z. Регион: `config.region` (`FI` → `gl=fi`), язык: `config.language` (`hl`); флаги `--hl`, `--gl` переопределяют.
- Живой интернет в тестах запрещён: loopback-сервер (`tests/support/server.ts`, расширяется) и записанные ответы в `tests/fixtures/research/`.
- Остальное — Global Constraints планов 1–2 (MIT/ISC/BSD/Apache-2.0, три уровня важности, коды выхода 0/1/2). **Публикация в npm, слияние в `main`, создание релиза на GitHub — только по явному подтверждению владельца.**

## Review Focus

1. **Источник вернул мусор или изменился формат** (подсказки: не JSON / пустой массив / HTML капчи; Trends: ответ без префикса `)]}'`, 429, 302 на consent): понятная ошибка с именем источника, без stack trace, остальные команды и остальные запросы не затронуты. Тесты в задачах 2 и 3.
2. **Сеть недоступна или 429 посреди `suggest`:** уже полученные подсказки сохраняются, в `errors[]` есть причина, повторный запуск берёт готовое из кэша. Тест в задаче 2.
3. **Финская диакритика и составные запросы:** `sähköasentaja`, `å/ä/ö` корректно кодируются в URL и не портятся в CSV (UTF-8, экранирование `"` и переводов строк, защита от CSV-инъекции: ячейка, начинающаяся с `= + - @`, префиксуется `'`). Тест в задаче 1.
4. **Враждебный сайт конкурента:** редирект на другой хост, бесконечное пространство URL, огромный ответ, `robots.txt` с `Disallow: /`, `<title>` с управляющими символами и разметкой, JSON-LD с мусором. Обход ограничен, не падает, данные чистятся (управляющие символы убираются, строки обрезаются до 300 символов). Тест в задаче 4.
5. **Просроченный/отозванный токен Search Console, нет квоты, нет доступа к ресурсу (403), `siteUrl` в виде `sc-domain:`:** понятное сообщение «что сделать» (`gsc auth`, добавить пользователя в ресурс), токен не печатается; при 429/квоте URL Inspection остановка с частичным результатом и сообщением, сколько проверено. Тесты в задачах 5 и 6.
6. **Утечка секретов:** `client_secret`, `refresh_token`, `access_token` не попадают ни в какой вывод и в кэш, даже при ошибке Google с эхом тела запроса. Тест (поиск секретов во всём захваченном выводе) в задачах 5 и 6.

---

## Структура файлов

```
src/
  research/
    types.ts         общие типы файлов данных (DataFile, ResearchError)
    cache.ts         createDiskCache(dir, ttlMs, now) — get/set, повреждённый файл = промах
    output.ts        renderData(file, "json"|"csv"|"md"), csvCell (защита от инъекции)
    alphabet.ts      alphabetFor(lang): string[]; QUESTION_TEMPLATES по языкам
    suggest.ts       runSuggest(opts, http): SuggestResult
    trends.ts        runTrends(opts, http): TrendsResult (неофициальный клиент)
    competitors.ts   analyzeCompetitor(url, fetcher, opts): CompetitorReport
    http.ts          HttpJson — узкий интерфейс fetch + createHttpJson(userAgent, timeoutMs)
  gsc/
    paths.ts         tokenPath(env): string
    token-store.ts   saveToken/loadToken/clearToken (0600), редактирование секретов
    oauth.ts         runLoopbackLogin(client, io), refreshAccessToken, loadAdc()
    api.ts           createGscClient(auth, http): inspectUrl, queryAnalytics, listSites
    match.ts         matchQueriesToTargets(rows, config): TargetCoverage[]
    redact.ts        redact(text, secrets): string
  commands/
    research.ts      runResearchSuggest / runResearchTrends / runResearchCompetitors
    gsc.ts           runGscAuth / runGscInspect / runGscQueries
  cli.ts             + команды research (suggest|trends|competitors), gsc (auth|inspect|queries)
tests/
  fixtures/research/ записанные ответы (suggest-*.json, trends-*.txt, competitor-site/)
  support/server.ts  + роуты для /complete/search, /trends/*, /oauth, /gsc (расширение)
  unit/research-*.test.ts  unit/gsc-*.test.ts
  e2e/research.test.ts  e2e/gsc.test.ts
docs/research.md  docs/gsc.md
```

---

### Task 1: Общая основа `research`: типы, кэш, вывод JSON/CSV/MD, алфавит

**Files:**
- Create: `src/research/types.ts`, `src/research/cache.ts`, `src/research/output.ts`, `src/research/alphabet.ts`, `src/research/http.ts`
- Test: `tests/unit/research-cache.test.ts`, `tests/unit/research-output.test.ts`, `tests/unit/research-alphabet.test.ts`

**Interfaces:**
- Produces:
  - `interface ResearchError { source: string; target: string; message: string }`
  - `interface DataFile<T> { kind: "suggest" | "trends" | "competitors" | "gsc-queries" | "gsc-inspect"; meta?: { generatedAt: string; version: string; params: Record<string, string | number | boolean> }; rows: T[]; errors: ResearchError[] }`
  - `interface HttpJson { getText(url: string, o?: { headers?: Record<string, string> }): Promise<{ status: number; headers: Record<string, string>; text: string }>; postJson(url: string, body: unknown, o?: { headers?: Record<string, string> }): Promise<{ status: number; text: string }> }`; `createHttpJson(o: { userAgent: string; timeoutMs: number }): HttpJson`
  - `interface DiskCache { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void> }`; `createDiskCache(dir: string, ttlMs: number, now?: () => number): DiskCache`; `nullCache: DiskCache`
  - `renderData<T extends object>(file: DataFile<T>, format: "json" | "csv" | "md", columns: (keyof T & string)[]): string`; `csvCell(v: unknown): string`
  - `alphabetFor(lang: "fi" | "sv" | "en" | undefined): string[]`; `questionTemplates(lang): string[]` (fi: `miten`, `mikä`, `paljonko`, `kuinka paljon`, `mitä maksaa`, `kuka`, `missä`; sv: `hur`, `vad`, `vem`, `var`, `vad kostar`; en: `how`, `what`, `how much`, `who`, `where`)

- [ ] **Step 1: Write failing tests**
  - cache: `set` then `get` returns the value; entry older than TTL (inject `now`) returns `undefined`; a file with invalid content in the cache dir returns `undefined` and does not throw; `nullCache.get` is always `undefined`; the key is hashed (file name contains no `/` or the raw key).
  - output: `csvCell('=cmd')` → `'=cmd` prefixed as `"'=cmd"`; `csvCell('a,"b"\n')` → `"a,""b""\n"` (quoted, quotes doubled); `csvCell('sähkö')` unchanged; `renderData(file, "json", cols)` has stable key order and ends with a single `\n`; `renderData(..., "md", cols)` is a table with `|` in cells escaped as `\|`; with `meta` omitted the JSON has no `meta` key.
  - alphabet: `alphabetFor("fi")` contains `ä`, `ö`, `å` and `a`…`z` (29 letters), `alphabetFor("en")` has 26, `alphabetFor(undefined)` equals the `en` one.
- [ ] **Step 2: Run** `npx vitest run tests/unit/research-cache.test.ts tests/unit/research-output.test.ts tests/unit/research-alphabet.test.ts` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the modules per Interfaces. Cache: one file per key `sha256(key).hex` with `{ at: number, value: string }` JSON. `createHttpJson` uses global `fetch` with `AbortSignal.timeout`, follows redirects manually up to 3 hops only within the same host, returns non-2xx as a result (does not throw), throws `Error("network: <short reason>")` on transport failure.
- [ ] **Step 4: Run** the three test files — Expected: PASS. Then `npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** `feat(research): shared cache, data output and alphabet`

---

### Task 2: `research suggest`

**Files:**
- Create: `src/research/suggest.ts`, `src/commands/research.ts` (only `runResearchSuggest`), `tests/fixtures/research/suggest-*.json`
- Modify: `src/cli.ts` (command group `research`, subcommand `suggest`), `tests/support/server.ts` (route `/complete/search`)
- Test: `tests/unit/research-suggest.test.ts`, `tests/e2e/research.test.ts` (suggest part)

**Interfaces:**
- Consumes: `HttpJson`, `DiskCache`, `DataFile`, `alphabetFor`, `questionTemplates`, `renderData` (task 1); `loadConfig`, `Config.language/region/targets.pages[].primary/secondary` (план 1).
- Produces:
  - `interface SuggestRow { seed: string; expansion: string; query: string; rank: number }` (`expansion` — буква/шаблон, `""` для самой основы)
  - `interface SuggestOptions { seeds: string[]; hl: string; gl: string; expand: "none" | "alphabet" | "questions" | "both"; delayMs: number; baseUrl?: string }`
  - `runSuggest(o: SuggestOptions, http: HttpJson, cache: DiskCache, sleep?: (ms: number) => Promise<void>): Promise<DataFile<SuggestRow>>`
  - CLI: `mielikki research suggest [seeds...] [--from-config] [--hl] [--gl] [--expand none|alphabet|questions|both] (default alphabet) [--delay 400] [--format json|csv|md (json)] [--output file] [--no-meta] [--refresh] [--no-cache] [--config]`. Without `seeds` and without `--from-config` — код 2 «укажите основы или --from-config»; `--from-config` берёт `targets.pages[].primary` и `secondary`.

- [ ] **Step 1: Write failing tests** (loopback server serving fixtures; `sleep` stubbed)
  - `suggest_returns_sorted_deduped_rows`: seed `sähköasentaja`, answers for the bare seed and `sähköasentaja a`…; rows are unique by `query`, sorted by `query` then `seed`; the query sent is `q=sähköasentaja%20a` (percent-encoded UTF-8) with `client=firefox&hl=fi&gl=fi`.
  - `suggest_expands_alphabet_fi_with_aao`: with `expand: "alphabet"` requests contain `å`, `ä`, `ö` expansions (29 + 1 bare request per seed) — assert on the server's request log.
  - `suggest_questions_expansion`: `questions` sends only prefix templates of the form `"<шаблон> <основа>"` (e.g. `miten sähköasentaja`); assert exactly `questionTemplates("fi").length` + 1 requests.
  - `suggest_respects_delay`: `sleep` called with 400 between consecutive requests (n−1 times), never for cache hits.
  - `suggest_uses_cache_on_second_run`: the second run makes 0 requests; `refresh` makes all again.
  - `suggest_partial_failure_keeps_results` (Review Focus 2): server answers 429 for one expansion → rows from other expansions kept, `errors` has one entry `{source:"google-suggest", target:"sähköasentaja ä", message: contains "429"}`.
  - `suggest_garbage_response` (Review Focus 1): HTML body / `[]` / JSON of wrong shape → an `errors` entry, no throw; if every request fails `runResearchSuggest` returns exit code 1 and prints `Google Suggest unavailable: …` to stderr with no stack trace.
  - `suggest_exit_codes`: no seeds → 2; some success → 0; all failed → 1.
  - `suggest_deterministic`: two runs with `--no-meta` and varied server delays produce identical bytes.
- [ ] **Step 2: Run** the new tests — Expected: FAIL.
- [ ] **Step 3: Implement** `runSuggest` (requests sequential, in sorted order of (seed, expansion); URL `https://suggestqueries.google.com/complete/search?client=firefox&hl=…&gl=…&q=…`, `baseUrl` override only for tests; response shape `[query, string[]]`, validate with zod; `rank` = index+1 in the answer; cache key = `suggest|hl|gl|q`) and `runResearchSuggest` (arguments → options, output to `--output` or stdout).
- [ ] **Step 4: Run** unit + e2e suggest tests — Expected: PASS; `npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** `feat(research): suggest command`

---

### Task 3: `research trends`

**Files:**
- Create: `src/research/trends.ts`, `tests/fixtures/research/trends-explore.txt`, `trends-multiline.txt`, `trends-multiline-bad.txt`
- Modify: `src/commands/research.ts` (add `runResearchTrends`), `src/cli.ts`, `tests/support/server.ts` (routes `/trends/api/explore`, `/trends/api/widgetdata/multiline`, cookie)
- Test: `tests/unit/research-trends.test.ts`, `tests/e2e/research.test.ts` (trends part)

**Interfaces:**
- Consumes: Task 1; `Config.region`.
- Produces:
  - `interface TrendsRow { term: string; weekStart: string; value: number }` (`value` 0–100 относительный интерес; `weekStart` ISO-дата)
  - `interface TrendsSummary { term: string; average: number; peakMonth: number | null; seasonality: number[] }` (`seasonality` — 12 средних по месяцам, нормированных до 0–100; `peakMonth` 1–12 или `null` при нулевых данных)
  - `interface TrendsOptions { terms: string[]; geo: string; hl: string; timeframe: string; baseUrl?: string }` (`timeframe` по умолчанию `today 5-y`)
  - `runTrends(o, http, cache): Promise<DataFile<TrendsRow> & { summary: TrendsSummary[] }>`
  - CLI: `mielikki research trends <term...> [--geo FI] [--hl] [--timeframe "today 5-y"] [--format] [--output] [--no-meta] [--refresh] [--no-cache]`. Терминов не больше 5 на запрос (ограничение Google): больше 5 → разбиение на группы по 5 **с общим якорным термином = первым**, чтобы значения были сравнимы; в документации — оговорка.

- [ ] **Step 1: Write failing tests**
  - `trends_parses_prefixed_json`: fixtures with the `)]}'` prefix (explore → token/request for the widget; multiline → timeline) produce rows sorted by (`term`, `weekStart`) with the right values.
  - `trends_summary_seasonality`: from a synthetic timeline with a peak in January, `peakMonth === 1`, `seasonality.length === 12`, `max(seasonality) === 100`; an all-zero timeline gives `peakMonth: null`.
  - `trends_blocked_is_clean_error` (Review Focus 1): 429, 302 to `consent.google.com`, HTML body, and a body without the prefix each end in a thrown `ResearchSourceError` with message beginning `Google Trends unavailable (unofficial source):`; `runResearchTrends` maps it to exit code 1, stderr has the message and no stack, and other commands remain usable (no global state).
  - `trends_groups_of_five_share_anchor`: 7 terms → 2 requests whose term lists are `[t1..t5]` and `[t1,t6,t7]`.
  - `trends_cache`: second run → 0 requests.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the unofficial client: GET `trends.google.com/trends/api/explore?hl=…&tz=0&req=<json>` → strip `)]}'\n` prefix → pick the `TIMESERIES` widget (`token`, `request`) → GET `/trends/api/widgetdata/multiline?hl=…&tz=0&req=<widget.request>&token=<widget.token>` → strip prefix → `default.timelineData[].{formattedAxisTime→time (unix seconds), value[]}`. Carry cookies from the first response into the second (`Set-Cookie` name=value only, in memory). Validate shapes with zod; any mismatch → `ResearchSourceError`. No third-party library.
- [ ] **Step 4: Run** tests — Expected: PASS; lint, typecheck.
- [ ] **Step 5: Commit** `feat(research): trends command (unofficial source, isolated errors)`

---

### Task 4: `research competitors`

**Files:**
- Create: `src/research/competitors.ts`, `tests/fixtures/research/competitor-site/` (mini-site served by the loopback server, with `robots.txt`, `sitemap.xml`, 6 pages incl. services/areas, JSON-LD)
- Modify: `src/commands/research.ts` (add `runResearchCompetitors`), `src/cli.ts`
- Test: `tests/unit/research-competitors.test.ts`, `tests/e2e/research.test.ts` (competitors part)

**Interfaces:**
- Consumes: `Fetcher`/`createFetcher` (`src/net/fetch.ts`), `parseStartUrl`, `normalizeCrawlUrl`, `isAssetPath` (`src/net/policy.ts`), `parsePage` (`src/parse/page.ts`), `parseRobots`, `parseSitemap`, `DataFile`.
- Produces:
  - `interface CompetitorPage { url: string; path: string; title: string | null; h1: string[]; h2: string[]; schemaTypes: string[]; wordCount: number; kind: "home" | "service" | "area" | "other"; depth: number }`
  - `interface CompetitorReport { site: string; sitemapUrls: number; pagesAnalyzed: number; stoppedBy: "done" | "max-pages"; urlPatterns: { pattern: string; count: number }[]; pages: CompetitorPage[]; terms: { term: string; pages: number }[]; errors: ResearchError[] }` (`pattern` — путь с заменой каждого сегмента глубины ≥2 на `*`, например `/alueet/*`; `terms` — 30 самых частых нестоп-слов (по основам языка `--language`, с примером формы) из title/h1/h2, считаются по числу страниц)
  - `analyzeCompetitor(startUrl: string, fetcher: Fetcher, o: { maxPages: number; language?: "fi" | "sv" | "en"; areaHints: string[] }): Promise<CompetitorReport>`; `kind` определяется по первому сегменту пути: `palvelu*|palvelut|tjanster|services` → service, `alue*|alueet|omraden|areas` и по `areaHints` (из `business.areaServed` конфига) → area.
  - CLI: `mielikki research competitors <url...> [--max-pages 30] [--delay 500] [--language] [--format json|md] [--output] [--no-meta]`. Файл содержит по записи на сайт (`rows: CompetitorReport[]`).

- [ ] **Step 1: Write failing tests**
  - `competitors_extracts_structure`: on the fixture mini-site, report has expected `pages` (sorted by path), `schemaTypes` like `["LocalBusiness"]`, h1/h2 lists, `kind` for `/palvelut/x/` = service and `/alueet/loviisa/` = area, `urlPatterns` contains `{pattern:"/alueet/*", count:2}`, `sitemapUrls` equals the sitemap count.
  - `competitors_obeys_robots_always`: fixture `robots.txt` with `Disallow: /private/` → no request to `/private/…` in the server log; with `Disallow: /` for `*` → `pagesAnalyzed: 0` and an `errors` entry «blocked by robots.txt», exit code 1 (nothing obtained).
  - `competitors_hostile_site` (Review Focus 4): server cases — redirect to another host (not followed, entry in `errors`), endless `/a/b/c/…` link space (stops at `maxPages`, `stoppedBy: "max-pages"`), body larger than `maxBytes` (error entry), `<title>` with control chars `\u0000\u0007` and 1000 characters (cleaned and cut to 300).
  - `competitors_does_not_leave_host`: links to other hosts are never requested (assert on the fake fetcher's `requested`).
  - `competitors_deterministic`: two runs with varied delays → identical bytes.
  - `competitors_partial_failure`: one page times out (stalled stream) → other pages present, error entry, exit code 0.
  - `competitors_no_own_site_warning`: the plan-2 warning about foreign sites is not printed (foreign sites are the point here); stderr has exactly one line «research competitors: вежливый обход, robots.txt соблюдается».
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** a level-wise BFS like `load/url.ts` (sorted per level, start URL first, `maxPages` cut in sorted order), seeding from sitemap URLs on the same host (first 200 considered, cut by `maxPages`). Cleaning helper `clean(s)`: strip `\p{Cc}` except space, collapse whitespace, trim, cut to 300. Fetcher options: `concurrency 1`, `delayMs` from flag, `allowRedirectHost: () => false`.
- [ ] **Step 4: Run** tests — Expected: PASS; lint, typecheck.
- [ ] **Step 5: Commit** `feat(research): competitors command`

---

### Task 5: `gsc auth`: OAuth (loopback + PKCE), ADC, хранилище токена

**Files:**
- Create: `src/gsc/paths.ts`, `src/gsc/token-store.ts`, `src/gsc/oauth.ts`, `src/gsc/redact.ts`, `src/commands/gsc.ts` (only `runGscAuth`)
- Modify: `src/cli.ts` (group `gsc`, subcommand `auth`), `tests/support/server.ts` (fake OAuth endpoints)
- Test: `tests/unit/gsc-token-store.test.ts`, `tests/unit/gsc-oauth.test.ts`, `tests/unit/gsc-redact.test.ts`, `tests/e2e/gsc.test.ts` (auth part)

**Interfaces:**
- Produces:
  - `tokenPath(env: NodeJS.ProcessEnv, home: string): string` → `${XDG_CONFIG_HOME ?? home/.config}/mielikki/gsc-token.json`
  - `interface StoredToken { clientId: string; clientSecret?: string; refreshToken: string; source: "oauth-client" | "adc" }`; `saveToken(path, t)` (mkdir 0700, file 0600, atomic write), `loadToken(path): Promise<StoredToken | undefined>` (повреждённый файл → `undefined`), `clearToken(path)`
  - `interface ClientSecrets { clientId: string; clientSecret: string; authUri: string; tokenUri: string }`; `readClientFile(path): Promise<ClientSecrets>` (формат Google «Desktop app» `{"installed": {...}}`; другой формат / `web` → `UsageError` с подсказкой создать клиент типа Desktop app)
  - `runLoopbackLogin(c: ClientSecrets, io: { openUrl(url: string): void; print(s: string): void; timeoutMs: number }, http: HttpJson): Promise<StoredToken>` — сервер на `127.0.0.1:0`, `redirect_uri=http://127.0.0.1:PORT`, PKCE (`S256`) и `state`; проверка `state`; `access_type=offline`, `prompt=consent`; обмен кода на `tokenUri`; таймаут → `UsageError`
  - `getAccessToken(t: StoredToken, http: HttpJson, tokenUri?: string): Promise<string>` (refresh-grant; `invalid_grant` → `UsageError("Доступ отозван или истёк: выполните mielikki gsc auth")`)
  - `loadAdc(env, home): Promise<StoredToken | undefined>` — читает `GOOGLE_APPLICATION_CREDENTIALS` или `~/.config/gcloud/application_default_credentials.json`, принимает только `type: "authorized_user"`
  - `redact(text: string, secrets: string[]): string` — заменяет любое вхождение секрета (длиной ≥ 6) на `[скрыто]`
  - CLI: `mielikki gsc auth [--client <path-to-client.json>] [--adc] [--logout] [--no-open]`. Без флагов: если сохранён токен — «уже авторизовано (источник …)»; иначе без `--client` и `--adc` → код 2 с пошаговой подсказкой (см. docs/gsc.md). `--no-open` только печатает ссылку.

- [ ] **Step 1: Write failing tests**
  - token-store: file mode is `0o600` and dir `0o700` after `saveToken`; round trip; corrupt JSON → `undefined`; `clearToken` removes the file; `tokenPath` honours `XDG_CONFIG_HOME`.
  - oauth (fake Google on loopback): the authorize URL printed contains `code_challenge_method=S256`, `scope=https://www.googleapis.com/auth/webmasters.readonly` (encoded), a random `state`; the fake token endpoint receives `code_verifier` whose SHA-256 base64url equals the challenge; callback with wrong `state` → rejected, no token saved; callback with `error=access_denied` → `UsageError`; no callback within `timeoutMs` → `UsageError` and the server port is closed; `getAccessToken` with `invalid_grant` → `UsageError` containing `gsc auth`.
  - readClientFile: Desktop client OK; `{"web": …}` → `UsageError` mentioning «Desktop app»; garbage → `UsageError`, message does not echo file content.
  - adc: `authorized_user` file accepted; `service_account` rejected with a clear message.
  - redact + leakage (Review Focus 6): running `runGscAuth` against the fake server where the token endpoint echoes the request body in an error response — the captured stdout+stderr contain none of `client_secret`, `refresh_token`, `code`, `code_verifier` values.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** All errors from Google pass through `redact` with the secrets known at that point before being shown. `openUrl` default spawns `xdg-open`/`open`/`start` without a shell and ignores failure (the URL is always printed too).
- [ ] **Step 4: Run** tests — Expected: PASS; lint, typecheck.
- [ ] **Step 5: Commit** `feat(gsc): auth with loopback OAuth, ADC and token store`

---

### Task 6: `gsc inspect` и `gsc queries`

**Files:**
- Create: `src/gsc/api.ts`, `src/gsc/match.ts`
- Modify: `src/commands/gsc.ts` (add `runGscInspect`, `runGscQueries`), `src/cli.ts`, `tests/support/server.ts` (fake Search Console API)
- Test: `tests/unit/gsc-api.test.ts`, `tests/unit/gsc-match.test.ts`, `tests/e2e/gsc.test.ts` (inspect/queries part)

**Interfaces:**
- Consumes: Task 5 (`getAccessToken`, `loadToken`, `loadAdc`, `redact`), Task 1 (`HttpJson`, `DataFile`, `renderData`, `DiskCache`), `loadUrl`-подобный сбор sitemap (используется `parseSitemap` + `Fetcher`), `Config.site`, `targets.pages`, `lang.stem`.
- Produces:
  - `interface InspectRow { url: string; verdict: string; coverageState: string; indexingState: string; robotsTxtState: string; pageFetchState: string; googleCanonical: string | null; userCanonical: string | null; lastCrawlTime: string | null }`
  - `interface QueryRow { query: string; page: string; clicks: number; impressions: number; ctr: number; position: number }`
  - `createGscClient(accessToken: string, http: HttpJson, base?: { inspect?: string; analytics?: string }): { inspectUrl(siteUrl: string, url: string, languageCode: string): Promise<InspectRow>; queryAnalytics(siteUrl: string, q: { startDate: string; endDate: string; rowLimit: number }): Promise<QueryRow[]> }`; `siteUrl` — `https://domain/` или `sc-domain:domain`
  - `class GscQuotaError extends Error { readonly done: number }`
  - `interface TargetCoverage { target: string; primary: string; matched: QueryRow[]; impressions: number; clicks: number; bestPosition: number | null; status: "no-data" | "ranking" | "other-page" }` — `matchQueriesToTargets(rows: QueryRow[], config: Config, lang: LangModule): TargetCoverage[]`: запрос относится к цели, если все основы токенов `primary` присутствуют среди основ токенов запроса (порядок и падежи не важны); `status: "ranking"` если совпавшие строки идут на страницу цели, `"other-page"` если только на другие (каннибализация/промах), `"no-data"` если совпадений нет.
  - CLI: `mielikki gsc inspect [--site <siteUrl>] [--from sitemap|targets (sitemap)] [--limit 200] [--format] [--output] [--no-meta]` (`--site` по умолчанию `config.site + "/"`; список URL — из sitemap `config.site`, получаемого через Fetcher только с хоста `config.site`); `mielikki gsc queries [--site] [--days 28] [--row-limit 1000] [--by-target] [--format] [--output] [--no-meta]`.
  - Квоты: не более 600 запросов/мин (интервал ≥ 100 мс) и `--limit` ≤ 2000 в сутки; при 429/`quotaExceeded` — `GscQuotaError` с `done`, команда пишет частичный файл и код выхода 1 с сообщением «проверено N из M; квота обновляется раз в сутки».
  - `mielikki gsc inspect` печатает в stdout/файл только данные, а в сводке (stderr) — число страниц по `verdict` (PASS/NEUTRAL/FAIL…), чтобы Claude Code сразу видел «не в индексе».

- [ ] **Step 1: Write failing tests**
  - api: request bodies match the API (`inspectionUrl`, `siteUrl`, `languageCode`; analytics `dimensions: ["query","page"]`, `startDate/endDate`, `rowLimit`) and carry `Authorization: Bearer <token>`; response mapping to `InspectRow`/`QueryRow` (ctr and position kept as returned); missing optional fields → `null`.
  - `api_error_messages` (Review Focus 5): 401 → `UsageError` «выполните mielikki gsc auth»; 403 → «нет доступа к ресурсу <siteUrl>: добавьте пользователя в Search Console или укажите --site sc-domain:…»; 429 → `GscQuotaError`; 5xx → one retry then error. No message contains the token.
  - match: `primary: "sähköasennukset loviisa"` matches queries `sähköasennus loviisassa` and `loviisan sähköasennukset`, not `sähköasennus porvoo`; status `other-page` when the only matches point to another URL; rows with `matched` sorted by impressions desc then query asc.
  - e2e (fake Search Console on loopback, sitemap served from the test server): `gsc inspect` writes a file with one row per sitemap URL, summary on stderr; with quota error on the 3rd call → exit 1, file contains the 2 completed rows, message «проверено 2 из …»; `gsc queries --by-target` prints coverage; all captured output contains none of the tokens (Review Focus 6).
  - Requests go only to the configured API base URLs plus the `config.site` host for the sitemap (assert on server logs).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Token resolution order: stored token (`loadToken`) → ADC (`loadAdc`) → `UsageError` with the setup hint. Access token only in memory.
- [ ] **Step 4: Run** tests — Expected: PASS; lint, typecheck.
- [ ] **Step 5: Commit** `feat(gsc): inspect and queries commands with target matching`

---

### Task 7: Документация, `init`, CLI-сборка и интеграционный прогон

**Files:**
- Create: `docs/research.md`, `docs/gsc.md`
- Modify: `README.md`, `src/commands/init.ts` (печатает совет добавить `.mielikki/` в `.gitignore`), `src/cli.ts` (описания, `--help`), `tests/e2e/cli-help.test.ts` (создать, если нет)
- Test: `tests/e2e/research.test.ts`, `tests/e2e/gsc.test.ts` (уже есть), `tests/e2e/cli-help.test.ts`

- [ ] **Step 1: Write failing tests**
  - `cli-help`: `mielikki --help` lists `check`, `perf`, `rules`, `init`, `research`, `gsc`; `mielikki research --help` lists `suggest`, `trends`, `competitors`; `mielikki gsc --help` lists `auth`, `inspect`, `queries`.
  - `no_network_for_check`: `check <dir>` and `rules` make zero network calls even when `.mielikki/cache` or a stored token exists (a global `fetch` stub that throws is installed in the test).
    - Built binary (`dist/cli.js`): `research suggest` without seeds and `gsc auth` without flags exit 2 with a hint; the network paths are covered by e2e tests that call `runResearch*`/`runGsc*` directly (the CLI has no base-URL override by design).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Write docs.** `docs/research.md`: workflow «research → файлы → анализ в Claude Code → карта целей в конфиге → check», форматы файлов (поля `kind`, `rows`, `errors`), кэш и `--refresh`, вежливость и ограничения, оговорка о нестабильности Trends и о ≤5 терминах, оговорка про подсказки (скудные данные для локальных запросов). `docs/gsc.md`: пошаговая настройка своего OAuth-клиента («Desktop app» в Google Cloud: создать проект → включить Search Console API → экран согласия (Testing, добавить себя в тестовые пользователи) → OAuth client ID типа Desktop app → скачать JSON → `mielikki gsc auth --client client.json`), вариант ADC (`gcloud auth application-default login --scopes=https://www.googleapis.com/auth/webmasters.readonly,https://www.googleapis.com/auth/cloud-platform` и `--adc`), где лежит токен и как удалить (`gsc auth --logout`), квоты URL Inspection (2000 запросов/сутки и 600/мин на ресурс — проверить актуальные значения в документации Google на момент написания и вписать с датой), что `siteUrl` бывает `sc-domain:`. README: раздел «Команды» дополнить, удалить пометки «план 3 / скоро».
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm run build && npm test` — Expected: всё зелёное (≥ 641 + новые тесты), три прогона подряд без флейков (`for i in 1 2 3; do npm test || break; done`).
- [ ] **Step 5: Commit** `docs: research and gsc guides, cli help tests`

---

### Task 8: Релиз 1.0.0 (подготовка; публикация — только по подтверждению)

**Files:**
- Modify: `package.json` (version `1.0.0`, `keywords`, `homepage`, `bugs`, `publishConfig: { access: "public", provenance: true }`), `src/version.ts` (если версия не читается из package.json), `README.md`, `.github/workflows/ci.yml`
- Create: `CHANGELOG.md`, `.github/workflows/release.yml`, `docs/releasing.md`
- Test: `tests/e2e/package.test.ts`

- [ ] **Step 1: Write failing test** `package.test.ts` (в scratch-копии, как в задаче 8 плана 2, чтобы `prepare` не пересобирал `dist/`): `npm pack --dry-run --json` lists exactly `dist/**`, `vendor/**`, `LICENSE`, `NOTICE`, `README.md`, `package.json` (никаких `tests/`, `docs/superpowers/`, `.mielikki/`, `*.map` — если карты исходников не нужны); `package.json.version === VERSION` из `src/version.ts` и `=== "1.0.0"`; установка пакета в чистый каталог (`npm i <tgz>`) и запуск `npx mielikki --version` печатает `1.0.0` и `npx mielikki rules` завершается кодом 0; `bin.mielikki` указывает на существующий файл с shebang и правом исполнения.
- [ ] **Step 2: Run** `npx vitest run tests/e2e/package.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Version 1.0.0 в `package.json`; `CHANGELOG.md` (Keep a Changelog: 1.0.0 — полный перечень команд 0.1→1.0, 84 + 17 + 1 правил, ссылка на `docs/rules.md`); `docs/rules.md` пересоздать `npm run docs:rules`; README: бейджи не добавлять без реальных источников, раздел установки `npx mielikki` и `npm i -D mielikki`, раздел «Приватность и сеть» с таблицей «какая команда к каким хостам ходит» (из Global Constraints). `release.yml`: триггер `push` тега `v*.*.*`, шаги `npm ci`, lint, typecheck, build, test, затем `npm publish --provenance --access public` с `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` и `permissions: { contents: read, id-token: write }`. **Workflow добавляется в репозиторий, но без секрета и без тега ничего не публикуется.** `docs/releasing.md`: порядок (проверить имя `mielikki` свободно: `npm view mielikki`; `npm pack --dry-run`; влить в `main`; тег `v1.0.0`; секрет `NPM_TOKEN`; публикация) с пометкой «каждый шаг подтверждает владелец».
- [ ] **Step 4: Run** полный набор: `npm run lint && npm run typecheck && npm run build && npm test` (три раза подряд) и `npm pack --dry-run` — Expected: зелёное, список файлов как в тесте. Затем проверить на реальном сайте хаба (только чтение, без запросов к боевым доменам, кроме `suggestqueries.google.com` в одном ручном прогоне): `node dist/cli.js research suggest "sähköasentaja loviisa" --expand none --format md` — печатает таблицу; `node dist/cli.js gsc auth` без параметров — код 2 с подсказкой; `node dist/cli.js check <dist хаба> --profile dev` — результат как до плана 3.
- [ ] **Step 5: Commit** `chore(release): 1.0.0 packaging, changelog, release workflow`

**Не входит в план (делает только владелец или по его подтверждению):** `git tag`, `git push --tags`, `npm publish`, создание GitHub Release, слияние `feat/plan-3-*` и `feat/plan-2-url-perf` в `main`, обновление закреплённого коммита Mielikki в хабе (PR #37).
