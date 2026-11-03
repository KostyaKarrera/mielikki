# Mielikki, план 2: URL-режим, правила `http/*` и `perf` (Lighthouse)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mielikki check <url>` обходит живой (в том числе локальный) сайт, строит ту же модель `Site`, что и режим папки, и прогоняет все существующие правила плюс новые `http/*`; `mielikki perf <url…>` снимает Lighthouse (мобильный профиль) и выдаёт находки в том же формате отчётов.

**Architecture:** Новый загрузчик `load/url.ts` (обход по уровням через инжектируемый `Fetcher`) строит `Site`; общая часть с `load/dir.ts` (разрешение ссылок, граф, глубина) выносится в `load/graph.ts`. Модель получает данные сети (`Site.responses`, `Page.url`, `Page.resources`, `Asset.headers`). Правила `http/*` — обычные правила с `inputs: ["url"]`, читающие модель. `perf` — отдельная команда: бегун Lighthouse подгружается динамически (необязательная зависимость), результат превращается в `Finding[]` чистой функцией.

**Tech Stack:** тот же, что в плане 1 (Node ≥ 22.12, TS strict ESM); сеть — встроенный `fetch` (undici), без новых обязательных зависимостей. Необязательные peer-зависимости для `perf`: `lighthouse` (Apache-2.0, требует Node ≥ 22.19) и `chrome-launcher` (Apache-2.0).

**Spec:** `docs/superpowers/specs/2026-11-01-mielikki-design.md` (разделы 5, 7.1, 8 «http», 9 «perf», 10)

**Это план 2 из 3.** Предыдущий: `2026-11-01-mielikki-1-core-check.md` (выполнен, `main` на 34e9b5c). Следующий — план 3: `research suggest/trends/competitors`, `gsc`, релиз 1.0 в npm; пишется после этого плана. Обходчик плана 2 переиспользуется в `research competitors`, поэтому `Fetcher` и ограничения обхода живут в `src/net/`, а не внутри `load/url.ts`.

## Global Constraints

- Сеть только к хостам проверяемого сайта: хост стартового URL (хост обхода). Редиректы на другие хосты **записываются, но не выполняются**. Никаких запросов к хосту `config.site`, если он отличается от хоста обхода (сайт на localhost, конфиг с боевым доменом — норма, см. задачу 3). Без телеметрии, без cookies, без авторизации; URL с `user:pass@` отклоняется (код 2).
- Определитель агента: `Mielikki/<версия> (+https://github.com/KostyaKarrera/mielikki)`.
- Умолчания обхода: `--max-pages 200`, `--max-assets 300`, `--concurrency 4` (локальный хост) или `2` (иной), `--delay 0` (локальный) или `100` мс (иной), `--timeout 15000` мс, `--max-bytes 5000000` (тело HTML/XML/TXT), не более 10 редиректов подряд. Все — флаги `check`.
- Хост «локальный» — по `isLocalHost` (`src/model/host.ts`). Проверка не-своего сайта (хост ≠ хосту `config.site` и не локальный) печатает предупреждение в stderr: «проверяйте только свои сайты или те, на которые есть разрешение».
- Детерминизм URL-режима: при одинаковых ответах сервера JSON-отчёт побайтно одинаков. В отчёт и модель не попадают время, длительности и порядок завершения запросов. Обход идёт уровнями, URL внутри уровня сортируются лексикографически, обрезка по `--max-pages` берёт первые в этом порядке. (`perf` — измерение, не детерминирован; README говорит об этом прямо.)
- Роботс сайта при обходе **не** соблюдается по умолчанию (это аудит своего сайта; правила сами сообщают о закрытии). `--respect-robots` включает соблюдение (агент `*`).
- Страницы с query-строкой не обходятся (записываются в `site.crawl.skipped`); `#fragment` отбрасывается.
- Тело ответа читается только до `--max-bytes`; превышение — `stop: "too-large"`. Не-HTML ответ на URL страницы не парсится.
- Во всём остальном действуют Global Constraints плана 1 (MIT/ISC/BSD/Apache-2.0, три уровня важности, коды выхода 0/1/2, публикация только по подтверждению). Этот план ничего не публикует и не пушит.
- Сетевые тесты — только на loopback (`127.0.0.1`, порт 0) и на подставном `Fetcher`; живой интернет в тестах запрещён.

## Review Focus

1. **Враждебный или кривой сервер:** бесконечный редирект, петля A→B→A, ответ больше лимита, зависание без ответа, не-HTML под URL страницы, бесконечное пространство URL (`/a/b/c/…`, `?page=N`). Обход ограничен, не падает, даёт находки `http/unreachable` / `http/redirect-chain` / `http/crawl-limit`. Тесты в задачах 2 и 3.
2. **`Location` на частный адрес или чужой хост** (`http://169.254.169.254/`, `https://evil.example/`): не выполняется, записывается как `stop: "left-site"`. Тест в задаче 2.
3. **Сайт на localhost с боевым `config.site`** (наш случай: `https://unnvsahko.fi` в конфиге, обход `http://127.0.0.1:PORT`): абсолютные ссылки на боевой домен обходятся через хост обхода; запроса к боевому хосту нет ни разу; canonical сравнивается с учётом соответствия хостов. Тест в задаче 3 (подставной `Fetcher` фиксирует каждый запрошенный URL).
4. **Варианты одного адреса** (`/a`, `/a/`, `/A/`, `/a/index.html`, `%`-кодирование): один ключ страницы, но все точные URL и их ответы сохранены; два URL с кодом 200 для одной страницы — находка, а не молчание. Тест в задачах 3 и 6.
5. **Частичный сбой:** одна страница таймаутит или даёт 500 — остальной обход идёт, находка `http/unreachable`, код выхода 1, не 2. Недоступен сам стартовый URL — код 2 с понятным сообщением. Тест в задаче 5.
6. **`perf` без Lighthouse или без Chrome** — код 2 и подсказка, что установить (`npm i -D lighthouse chrome-launcher`, переменная `CHROME_PATH`), без stack trace. Падение Lighthouse на одном URL не отбрасывает результаты остальных. Тест в задаче 8.

---

## Структура файлов

```
src/
  net/fetch.ts          createFetcher: GET/HEAD, ручные редиректы, лимиты, таймаут
  net/limiter.ts        createLimiter(concurrency, delayMs)
  net/policy.ts         parseStartUrl, normalizeCrawlUrl, mapToCrawl, isAssetPath
  load/graph.ts         buildSiteGraph — общая часть loadDir и loadUrl
  load/url.ts           loadUrl: обход → Site
  load/probes.ts        проверочные запросы (http-вариант, www, слэш, 404-проба)
  rules/http/*.ts       правила http/* (+ index.ts)
  rules/links/redirected.ts
  perf/lhr.ts           типы подмножества LHR
  perf/findings.ts      perfFindings(lhr, preset): Finding[]
  perf/rules.ts         perfRuleMetas (метаданные для rules/explain/docs)
  perf/runner.ts        loadLighthouseRunner (динамический import)
  commands/perf.ts      runPerf
tests/
  support/server.ts     serveDir(dir, behaviors): loopback-сервер для тестов
  support/fake-fetcher.ts  scriptedFetcher(map): подставной Fetcher
  unit/{fetch,policy,graph,load-url,perf-findings}.test.ts  unit/rules/http/*.test.ts
  e2e/url-mode.test.ts  e2e/perf.test.ts
  fixtures/lhr/{good,poor}.json   записанные (урезанные) отчёты Lighthouse
```

---

### Task 1: Основа — модель сети, `buildSiteGraph`, ресурсы страницы

**Files:**
- Create: `src/load/graph.ts`, `tests/unit/graph.test.ts`
- Modify: `src/model/types.ts`, `src/load/dir.ts`, `src/parse/page.ts`, `tests/unit/parse-page.test.ts`

**Interfaces:**
- Produces (в `src/model/types.ts`):
  ```ts
  export interface Hop { url: string; status: number; location?: string }
  export interface Fetched { url: string; status: number; headers: Record<string, string>; contentType?: string; bytes: number; body?: string }
  export type StopReason = "left-site" | "redirect-loop" | "too-many-redirects" | "timeout" | "too-large" | "network";
  export interface FetchRecord { requested: string; hops: Hop[]; final?: Fetched; stop?: StopReason; detail?: string }
  export interface Resource { kind: "script" | "style" | "iframe" | "media" | "other"; src: string }
  // Page: + url?: string (финальный абсолютный URL), + resources: Resource[]
  // Asset: + headers?: Record<string, string>
  // Site: + origin?: string (хост обхода), + responses?: Map<string, FetchRecord>,
  //       + crawl?: { limitReached: boolean; skipped: string[] }
  ```
  Имена заголовков в `headers` — в нижнем регистре.
- Produces (`src/load/graph.ts`):
  ```ts
  export function buildSiteGraph(input: { pages: Page[]; notFound?: Page; siteUrl?: string; config: Config }): { byKey: Map<string, Page>; unique: Page[]; inlinks: Map<string, string[]>; inlinksAll: Map<string, string[]>; depth: Map<string, number> }
  ```
  Выносит из `loadDir`: дедупликацию по ключу, `resolveHref` для ссылок и картинок (в т.ч. `notFound`), `inlinks`/`inlinksAll`/`depth`. `detectSite` тоже переезжает и экспортируется.

- [ ] **Step 1: Failing tests.** `parse-page.test.ts`: `parsePage` собирает `resources` в порядке документа: `<script src>`→`script`, `<link rel=stylesheet|preload as=…|modulepreload>`→`style`/`script`/`other`, `<iframe src>`→`iframe`, `<video|audio|source src>`→`media`; встроенные скрипты без `src` не попадают; пустая страница → `[]`. `graph.test.ts`: тот же набор страниц даёт те же `inlinks`/`depth`, что `loadDir` на эквивалентной папке (сравнить на фикстуре `good`).
- [ ] **Step 2: Run** `npx vitest run tests/unit/graph.test.ts tests/unit/parse-page.test.ts` — падают.
- [ ] **Step 3: Implement.** Типы в `model/types.ts`; `parsePage` заполняет `resources` (обязательное поле; поправить все места, где `Page` строится литералом); `loadDir` вызывает `buildSiteGraph` и ставит в `Site` те же поля, что раньше (поведение режима папки не меняется ни в чём).
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck` — все 439 прежних тестов зелёные, новые зелёные, снапшоты e2e **не** изменились.
- [ ] **Step 5: Commit** `refactor: shared site graph, network model types, page resources`.

---

### Task 2: `Fetcher`: запросы, ручные редиректы, лимиты

**Files:**
- Create: `src/net/fetch.ts`, `src/net/limiter.ts`, `tests/support/server.ts`, `tests/unit/fetch.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FetcherOptions { userAgent: string; timeoutMs: number; maxBytes: number; maxHops: number; concurrency: number; delayMs: number; allowRedirectHost(host: string): boolean; mapUrl?(url: string): string }
  export interface GetOptions { method?: "GET" | "HEAD"; follow?: boolean; wantBody?: boolean }
  export interface Fetcher { get(url: string, o?: GetOptions): Promise<FetchRecord> }
  export function createFetcher(o: FetcherOptions): Fetcher
  export function createLimiter(concurrency: number, delayMs: number): <T>(fn: () => Promise<T>) => Promise<T>
  ```
  Контракт `get`: никогда не бросает (сетевая ошибка → `stop: "network"` + `detail`). `follow: true` (по умолчанию) идёт по 3xx, каждый 3xx добавляется в `hops`, `final` — первый не-3xx. `follow: false` → `final` = первый ответ как есть (включая 3xx, заголовок `location` в `headers`), `hops` пуст. Редирект на хост, не прошедший `allowRedirectHost`, не выполняется: последний hop записан, `stop: "left-site"`, `final` не задан. `mapUrl` применяется к запрашиваемому URL и к каждому `Location` до проверки хоста (задача 3 использует это для сайта на localhost). Повтор уже посещённого URL в цепочке → `stop: "redirect-loop"`; больше `maxHops` → `"too-many-redirects"`. Тело: читается потоком до `maxBytes` только если `wantBody !== false` и тип `text/html`, `application/xhtml+xml`, `text/xml`, `application/xml`, `text/plain`; для `HEAD` тела нет; `bytes` — длина прочитанного тела, для `HEAD`/без тела — `content-length`, если есть, иначе 0. Таймаут (`AbortSignal.timeout`) → `"timeout"`.
  `tests/support/server.ts`: `serveDir(dir: string, b?: Behaviors): Promise<{ url: string; close(): Promise<void>; requests: string[] }>`, где `Behaviors = { slash?: "redirect" | "serve"; redirects?: Record<string, { status: number; location: string }>; headers?: Record<string, Record<string, string>>; status?: Record<string, number>; delayMs?: Record<string, number>; gzip?: boolean; extra?: Record<string, { type: string; body: string | Buffer }> }`; слушает `127.0.0.1:0`; `requests` — лог путей в порядке прихода; `/a` → 301 `/a/` при `slash: "redirect"`, `index.html` отдаётся для `/a/`.

- [ ] **Step 1: Failing tests** (`fetch.test.ts`, сервер `serveDir` на временной папке): 200 с телом и заголовками в нижнем регистре; цепочка 301→302→200 даёт `hops.length === 2` и `final.status === 200`; `follow:false` на 301 возвращает `final.status === 301` и `final.headers.location`; петля A→B→A → `stop:"redirect-loop"`; 12 редиректов подряд → `"too-many-redirects"`; `Location: http://169.254.169.254/latest/` и `Location: https://evil.example/` не вызывают запросов к этим хостам (подставить `allowRedirectHost = h => h === "127.0.0.1"`; проверить `stop:"left-site"` и что `requests` сервера не пополнился); тело больше `maxBytes` → `"too-large"`; сервер, не отвечающий дольше `timeoutMs` → `"timeout"`; закрытый порт → `"network"`; `HEAD` не читает тело; `mapUrl` подменяет хост `Location`; лимитер: при `concurrency=2` одновременно выполняется не более двух задач, при `delayMs>0` между стартами пауза не меньше `delayMs`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/fetch.test.ts` — падает.
- [ ] **Step 3: Implement** `createFetcher` на глобальном `fetch` с `redirect: "manual"`, заголовками `User-Agent` и `Accept-Encoding: gzip, br`; `createLimiter` — очередь с счётчиком и разнесением стартов по `delayMs`.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** `feat(net): fetcher with manual redirects, limits and loopback test server`.

---

### Task 3: Загрузчик `loadUrl`: обход, robots, sitemap, граф

**Files:**
- Create: `src/net/policy.ts`, `src/load/url.ts`, `tests/support/fake-fetcher.ts`, `tests/unit/policy.test.ts`, `tests/unit/load-url.test.ts`

**Interfaces:**
- Consumes: `Fetcher` (задача 2), `buildSiteGraph` (задача 1), `parsePage`, `parseRobots`, `parseSitemap`.
- Produces:
  ```ts
  export interface CrawlOptions { maxPages: number; maxAssets: number; respectRobots: boolean }
  export async function loadUrl(startUrl: string, config: Config, fetcher: Fetcher, opts: CrawlOptions): Promise<Site>
  // src/net/policy.ts
  export function parseStartUrl(raw: string): URL            // UsageError: не http(s), есть user:pass, не парсится
  export function mapToCrawl(url: string, crawlOrigin: string, siteOrigin?: string): string  // siteOrigin -> crawlOrigin, иное без изменений
  export function normalizeCrawlUrl(url: string): { url: string; query: boolean }            // без hash; query помечается
  export function isAssetPath(pathname: string): boolean                                     // jpg png webp avif gif svg ico css js mjs woff woff2 ttf otf pdf xml txt json zip mp4 webmanifest map
  // tests/support/fake-fetcher.ts
  export function scriptedFetcher(script: Record<string, Partial<FetchRecord> | { html: string; status?: number; headers?: Record<string, string> }>): Fetcher & { requested: string[] }
  ```
  Алгоритм (все пункты обязательны):
  1. **Хосты.** `crawlOrigin` = origin стартового URL; `siteOrigin` = origin `config.site`, если задан. Любой исходящий запрос проходит `mapToCrawl`; ссылки на хост `config.site` считаются внутренними (их `resolveHref` уже определяет по `site`) и запрашиваются через хост обхода. Запрос к хосту, отличному от хоста обхода, не отправляется никогда.
  2. **Уровни.** Уровень 0 — стартовый URL + `<loc>` из sitemap (после загрузки sitemap, см. п. 5). Дальше — внутренние ссылки со страниц текущего уровня. На каждом уровне URL уникализируются по точной строке, сортируются, запрашиваются партией через лимитер; в `site.responses` ключ — запрошенный URL. Без query, не `isAssetPath`. Лимит `maxPages` считается по успешным HTML-страницам; при превышении `site.crawl.limitReached = true`, остаток уходит в `crawl.skipped` (отсортирован, не более 50).
  3. **Страницы.** Финальный ответ 200 с HTML-типом → `parsePage(body, pageKey(pathname финального URL))`, затем `page.status`, `page.headers`, `page.url`; токены `x-robots-tag` добавляются в `page.robotsMeta` (нижний регистр, без дублей). Прочие финальные ответы (4xx, 5xx, не-HTML, `stop`) в `pages` не попадают, но остаются в `responses`. При совпадении ключей побеждает первый по сортировке точный URL.
  4. **`exclude.ignore`**: такие страницы обходятся (ссылки должны разрешаться), но не попадают в `site.pages` — как в режиме папки.
  5. **robots и sitemap.** GET `/robots.txt` на хосте обхода: 200 → `site.robots = parseRobots(body, siteUrl)`; иное → `site.robots` не задан, ответ в `responses`. Sitemap — из `robots.sitemaps` (через `mapToCrawl`), иначе из тех же трёх путей по умолчанию, что в `loadDir`; индексы раскрываются рекурсивно; недоступный листинговый sitemap → `SitemapInfo { ok: false, error: "HTTP <status>" | "<stop reason>" }`; найденный 404 по умолчанию-пути молчит, как в режиме папки.
  6. **`Site`:** `input = { kind: "url", root: startUrl }`, `origin = crawlOrigin`, `site = config.site ?? detectSite(pages) ?? crawlOrigin`, `assets` пока пуст (задача 4), `notFound` не задан (задача 4).
  7. `respectRobots`: URL, закрытый для `*`, не запрашивается, попадает в `crawl.skipped`.

- [ ] **Step 1: Failing tests.** `policy.test.ts`: `parseStartUrl("https://u:p@a.fi")` бросает `UsageError`, `ftp://` бросает; `mapToCrawl("https://unnvsahko.fi/a/", "http://127.0.0.1:5", "https://unnvsahko.fi") === "http://127.0.0.1:5/a/"`, чужой хост не меняется; `normalizeCrawlUrl("/a/?x=1#f")` → `query: true`; `isAssetPath("/img/a.JPG")` истина, `/palvelut/` ложь. `load-url.test.ts` (через `scriptedFetcher`): (а) стартовая → две внутренние страницы → страницы в `site.pages` в порядке ключей, `inlinks`/`depth` верны; (б) `/a` 301→`/a/`: одна страница, обе записи в `responses`; (в) **Review Focus 3**: `config.site="https://prod.fi"`, обход `http://127.0.0.1:5`, страница ссылается на `https://prod.fi/b/` — `requested` содержит `http://127.0.0.1:5/b/` и не содержит ни одного URL с `prod.fi`; (г) **RF 1:** бесконечное пространство `/p1/` → `/p2/` → … при `maxPages: 5` даёт ровно 5 страниц, `limitReached`, `skipped` отсортирован; (д) `X-Robots-Tag: noindex` попадает в `robotsMeta`; (е) sitemap-индекс с вложенным sitemap раскрывается, листинговый 404 даёт `ok:false`; (ж) повторный прогон даёт идентичный `Site` (сравнить сериализацию страниц и ключей `responses`); (з) страница с `?x=1` не запрашивается и лежит в `skipped`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/policy.test.ts tests/unit/load-url.test.ts` — падают.
- [ ] **Step 3: Implement** `policy.ts` и `loadUrl` по алгоритму; общий код с `loadDir` берётся из `buildSiteGraph`, `loadSitemaps` разобрать на независимую от источника часть, если это убирает дублирование.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** `feat(load): URL crawler building the site model`.

---

### Task 4: Ресурсы и проверочные запросы

**Files:**
- Create: `src/load/probes.ts`, `tests/unit/probes.test.ts`
- Modify: `src/load/url.ts`

**Interfaces:**
- Consumes: `loadUrl` из задачи 3.
- Produces (`src/load/probes.ts`):
  ```ts
  export async function loadAssets(site: Site, fetcher: Fetcher, max: number): Promise<void>      // site.assets
  export async function runProbes(site: Site, fetcher: Fetcher): Promise<void>                    // site.responses + site.notFound
  export const NOT_FOUND_PROBE = "/__mielikki_404__/";
  ```
  `loadAssets`: собирает внутренние ключи картинок и `page.resources` (внутренние), уникализирует, сортирует, берёт первые `max`, запрашивает `HEAD` (при 405/501 — `GET` с `wantBody:false`); успешный 200 → `site.assets.set(key, { key, bytes: content-length ?? bytes, ext, headers })`; не-200 или `stop` → ресурс **не** добавляется (правила «битая картинка» срабатывают так же, как в режиме папки), ответ остаётся в `responses`.
  `runProbes` (все запросы `follow:false`, результат в `responses` по точному URL):
  1. `NOT_FOUND_PROBE` на хосте обхода; если ответ 404 с HTML-телом — `site.notFound = parsePage(...)`.
  2. Только если хост обхода не локальный: `http://` вариант стартового хоста (если стартовый `https`), и вариант `www.`/без `www.` (ответ только фиксируется, не выполняется дальше).
  3. Для первых 10 по сортировке страниц с ключом ≠ `/` и без расширения файла: вариант того же пути с противоположным конечным слэшем.
  Все эти зонды добавляются, только если `site.crawl.limitReached` не мешает (они не считаются в `maxPages`). `loadUrl` вызывает `loadAssets`, затем `runProbes` перед возвратом.

- [ ] **Step 1: Failing tests** (`scriptedFetcher`): картинка 200 с `content-length: 123456` попадает в `site.assets` с `bytes: 123456` и заголовками; картинка 404 не попадает, а правило `images/…`/`links/broken-internal` на таком сайте срабатывает (проверить хотя бы существующим `links/broken-internal`); `HEAD` 405 повторяется как `GET` без тела; проба `/__mielikki_404__/` с кодом 200 записана в `responses`; на локальном хосте `http://`- и `www`-зонды **не** отправляются (`requested` не содержит их); на нелокальном — отправляются, и `Location` на `www` не выполняется; слэш-вариант строится для `/palvelut/` как `/palvelut` и наоборот, не для `/` и не для `/x.pdf`; число зондов слэша ≤ 10.
- [ ] **Step 2: Run** `npx vitest run tests/unit/probes.test.ts` — падает.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** `feat(load): asset sizes and URL-form probes`.

---

### Task 5: `check <url>` в CLI и паритет с режимом папки

**Files:**
- Modify: `src/commands/check.ts`, `src/cli.ts`, `src/report/*` при необходимости, `README.md` (раздел URL-режима)
- Create: `tests/e2e/url-mode.test.ts`

**Interfaces:**
- Consumes: `loadUrl`, `createFetcher`, `serveDir`.
- Produces: `runCheck(target, opts, io)` — если `target` начинается с `http://` или `https://`, идёт URL-режим; `CheckOptions` расширяется полями `maxPages`, `maxAssets`, `concurrency`, `delay`, `timeout`, `maxBytes`, `respectRobots` (необязательные, умолчания из Global Constraints). Флаги CLI: `--max-pages <n>`, `--max-assets <n>`, `--concurrency <n>`, `--delay <ms>`, `--timeout <ms>`, `--max-bytes <n>`, `--respect-robots`; в режиме папки они игнорируются без ошибки. `CheckResult.input = { kind: "url", root: <стартовый URL без query/hash> }`, `summary.pages` — число страниц в `site.pages`. Недоступный стартовый URL (нет `final` или статус ≥ 400 без HTML) → `UsageError("Start URL is not reachable: <url> (<причина>)")`, код 2. Предупреждение о чужом сайте — в stderr через `io.warn`.

- [ ] **Step 1: Failing tests** (`url-mode.test.ts`, `serveDir` на копиях фикстур `tests/fixtures/sites/*`): **паритет** — для каждой из `good`, `prelaunch`, `broken-a`, `broken-b`, `broken-c`, `astro-like` набор находок `check <dir>` и `check <url>` (по `ruleId + severity + url`, без `http/*` и `links/redirected`) совпадает, кроме явно перечисленных в константе `PARITY_EXCEPTIONS` (каждое исключение с комментарием причины; пустой список — идеал, расхождения разбираются, а не прячутся); `Review Focus 5`: страница с `delayMs` больше `--timeout` не роняет обход (код 0/1, не 2, находок `http/unreachable` пока нет — их добавит задача 6, тест фиксирует только отсутствие падения и наличие остальных страниц); недоступный стартовый URL (порт закрыт) → код 2 и текст про «not reachable»; `https://u:p@host` → код 2; `--format json` дважды подряд идентичен побайтно; предупреждение о чужом сайте появляется для нелокального хоста, не равного `config.site` (на scripted-фетчере, без сети).
- [ ] **Step 2: Run** `npx vitest run tests/e2e/url-mode.test.ts` — падает.
- [ ] **Step 3: Implement.** Все правила `inputs: ["dir","url"]`, которые читают `page.file` или `site.input.root`, привести к режиму без файлов (поиск: `grep -rn "page.file\|input.root\|readFile" src/rules`); расхождения паритета устранить в правилах или загрузчике, а не в тесте.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** `feat(check): URL mode with crawl limits and parity tests`.

---

### Task 6: Правила `http/*`: доступность, редиректы, хосты

**Files:**
- Create: `src/rules/http/{unreachable,crawl-limit,redirect-chain,redirect-temporary,not-https,https-redirect,host-variant,slash-variants,canonical-redirects,robots-status}.ts`, `src/rules/http/index.ts`, `src/rules/links/redirected.ts`, `tests/unit/rules/http/*.test.ts`
- Modify: `src/rules/all.ts`, `src/rules/links/index.ts`, `docs/rules.md` (регенерация)

**Interfaces:**
- Consumes: `Site.responses`, `Site.crawl`, `Page.url`; формат правила из `src/rules/types.ts`; кластеризация `src/rules/_cluster.ts` (R18) и политика молчания при перекрытии (R17) — смотреть, как применены в `links/trailing-slash`.
- Produces — каждое правило `inputs: ["url"]`, у каждого `meta.source` (документация Google Search Central или `squirrelscan:<id>`), `fix` на английском как в плане 1:

| id | scope | severity | launchBlocking | срабатывает, когда |
|---|---|---|---|---|
| `http/unreachable` | site | error | да | внутренний URL из `responses` закончился `stop` ∈ {timeout, network, too-large} или статусом ≥ 500 |
| `http/crawl-limit` | site | info | нет (`nonBlocking`) | `site.crawl.limitReached`; сообщает число пропущенных |
| `http/redirect-chain` | site | warning | нет | в цепочке ≥ 2 редиректов; петля или `too-many-redirects` — `severity: "error"` |
| `http/redirect-temporary` | site | warning | нет | URL страницы из sitemap, стартовый или перелинкованный из контента отвечает 302/303/307 |
| `http/not-https` | site | error | да | финальный URL старта `http:` на нелокальном хосте |
| `http/https-redirect` | site | warning | да | зонд `http://` не отвечает 301/308 на `https://` того же пути |
| `http/host-variant` | site | error (200-дубль) / info (недоступен) | да | `www`-вариант (или без `www`) отвечает 200, а не редиректом на основной хост |
| `http/slash-variants` | site | warning | нет | противоположная форма слэша отвечает 200 (дубль) |
| `http/canonical-redirects` | page | warning | да | canonical (с учётом `mapToCrawl`) отличается от `page.url` только формой (слэш, регистр, `www`) или его ответ — редирект |
| `http/robots-status` | site | error (5xx/timeout) / warning (401/403) | да | ответ на `/robots.txt` |
| `links/redirected` | site | warning | нет | внутренняя ссылка ведёт на точный URL, который отвечает 301/308; одна находка на целевой URL со списком страниц-источников в `details`; молчит, если ссылку уже объясняет `links/trailing-slash` (R17) |

- [ ] **Step 1: Failing tests** — по файлу на правило, через `loadUrl` + `scriptedFetcher`, минимум «срабатывает» и «не срабатывает» на каждое, плюс: `unreachable` — страница с `stop:"timeout"` и страница 503 дают по находке, а 404 — нет (это территория `links/broken-internal`); `redirect-chain` — петля A→B→A даёт `error`; `canonical-redirects` — canonical `/a` при странице `/a/` срабатывает, canonical на тот же URL с боевым хостом при обходе localhost **не** срабатывает; `slash-variants` — **Review Focus 4**: `/a` и `/a/` оба 200 → находка, `/a` 301→`/a/` → тишина; `links/redirected` — 100 страниц со ссылкой на один редиректящий URL дают одну находку, не сто; для всех правил профиль `launch` повышает ровно помеченные `launchBlocking`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/rules/http` — падают.
- [ ] **Step 3: Implement** правила и регистрацию в `all.ts`; `npm run build && npm run docs:rules`.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck`; убедиться, что в режиме папки список запущенных правил не изменился (`inputs` фильтрует).
- [ ] **Step 5: Commit** `feat(rules): http redirect, host and availability rules`.

---

### Task 7: Правила `http/*`: soft 404, смешанный контент, заголовки, сжатие, кэш

**Files:**
- Create: `src/rules/http/{soft-404,not-found-page,mixed-content,security-headers,compression,cache-headers}.ts`, `tests/unit/rules/http/*.test.ts`
- Modify: `src/rules/http/index.ts`, `docs/rules.md` (регенерация)

**Interfaces:** те же, что в задаче 6.

| id | scope | severity | launchBlocking | срабатывает, когда |
|---|---|---|---|---|
| `http/soft-404` | site | error (проба) / warning (страница) | да | проба `NOT_FOUND_PROBE` ответила 200; либо страница с 200, у которой title или H1 совпадает с фразой «не найдено» языка сайта (fi «ei löytynyt», «sivua ei löydy»; sv «hittades inte»; en «not found»; везде «404») |
| `http/not-found-page` | site | info | нет | проба 404 вернула тело < 512 байт либо без ссылки на `/` |
| `http/mixed-content` | page | warning | нет | страница с `https:` URL содержит ресурс (`resources` или картинку) по `http://`; для нелокального старта |
| `http/security-headers` | site | info | нет | у стартовой страницы нет `x-content-type-options: nosniff`, `referrer-policy`, защиты от фреймов (`x-frame-options` или `frame-ancestors` в CSP), а на `https` нелокальном хосте ещё `strict-transport-security`; одна находка, `details.missing` |
| `http/compression` | site | warning | нет | HTML-страницы с телом > 1400 байт без `content-encoding` ∈ {gzip, br, zstd}; пропускается на локальном хосте; одна находка со счётчиком и первыми 5 примерами |
| `http/cache-headers` | site | info | нет | внутренние картинки, css и js без `cache-control` с `max-age` ≥ 86400 (или `immutable`); пропускается на локальном хосте; одна находка, первые 5 примеров |

- [ ] **Step 1: Failing tests** — по правилу «срабатывает / не срабатывает» через `scriptedFetcher`; для `soft-404` на языке `fi`: страница с H1 «Sivua ei löytynyt» и статусом 200 даёт warning, страница «Ei löytynyt maalle» не должна давать ложного срабатывания в слове «löytynyt» внутри обычного текста (проверяется только title/H1 целиком по фразе); `mixed-content` не срабатывает на `http://` ссылке `<a href>` (это ссылка, не ресурс); `security-headers` не требует HSTS на `http:` и на локальном хосте; `compression` и `cache-headers` молчат на `127.0.0.1`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/rules/http` — падают.
- [ ] **Step 3: Implement**, регистрация, `npm run build && npm run docs:rules`.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** `feat(rules): http content, header and caching rules`.

---

### Task 8: `mielikki perf` — Lighthouse

**Files:**
- Create: `src/perf/{lhr,findings,rules,runner}.ts`, `src/commands/perf.ts`, `tests/unit/perf-findings.test.ts`, `tests/e2e/perf.test.ts`, `tests/fixtures/lhr/good.json`, `tests/fixtures/lhr/poor.json`
- Modify: `src/cli.ts`, `src/commands/rules.ts` и `src/report/result.ts` (метаданные правил `perf/*` учитываются в `rules`, `rules explain` и `ruleLabel`), `package.json` (`peerDependencies` + `peerDependenciesMeta`), `README.md`

**Interfaces:**
- Produces:
  ```ts
  // lhr.ts — только читаемые поля отчёта Lighthouse
  export interface LhrAudit { id: string; title: string; score: number | null; numericValue?: number; displayValue?: string; details?: { type?: string; overallSavingsMs?: number } }
  export interface LhrSubset { finalDisplayedUrl: string; configSettings: { formFactor: "mobile" | "desktop" }; categories: { performance: { score: number | null } }; audits: Record<string, LhrAudit>; runWarnings: string[] }
  // runner.ts
  export type LighthouseRunner = (url: string, o: { preset: "mobile" | "desktop"; chromePath?: string; noSandbox: boolean }) => Promise<LhrSubset>;
  export async function loadLighthouseRunner(): Promise<LighthouseRunner>   // UsageError с подсказкой, если lighthouse/chrome-launcher/Chrome не найдены
  // findings.ts
  export function perfFindings(lhr: LhrSubset, url: string): Finding[]
  export function medianLhr(runs: LhrSubset[]): LhrSubset                     // медиана numericValue по аудитам, остальное из первого прогона
  // commands/perf.ts
  export async function runPerf(urls: string[], opts: PerfOptions, io: IO, runner?: LighthouseRunner): Promise<number>
  ```
  Пороги (web.dev): LCP хорошо ≤ 2500 мс, плохо > 4000; CLS ≤ 0.1 / > 0.25; TBT ≤ 200 мс / > 600 (прокси INP, так и сказано в `fix`); FCP ≤ 1800 / > 3000. Плохо → `warning`, нуждается в улучшении → `info`, хорошо → ничего. Правила: `perf/lcp`, `perf/cls`, `perf/tbt`, `perf/fcp`, `perf/score` (info, оценка категории 0–100, только как справка), `perf/opportunity` (info; аудиты с `details.overallSavingsMs ≥ 300` и `score < 0.9`, не более 5, по убыванию экономии затем по `id`), `perf/run-failed` (warning; Lighthouse упал на URL). У каждого — `meta.source` (web.dev / Lighthouse), `scope: "page"`, `inputs: ["url"]`, `launchBlocking: false`; они **не** попадают в `allRules` (их не запускает `check`), но выводятся командами `rules` / `rules explain` / docs с пометкой «запускается командой perf».
  CLI: `mielikki perf <url…> [--preset mobile|desktop] [--runs <n>] [--chrome-path <p>] [--no-sandbox] [--format text|json|md] [--output <f>] [--fail-on <sev>] [--config <p>]`; по умолчанию `--preset mobile`, `--runs 1`, `--fail-on error`. Результат — тот же `CheckResult` (`input.kind: "url"`, `profile: "dev"`). Chrome ищется через `chrome-launcher`/`CHROME_PATH`.
  `package.json`: `peerDependencies: { "lighthouse": ">=13", "chrome-launcher": ">=1" }`, оба в `peerDependenciesMeta` с `optional: true`.

- [ ] **Step 1: Failing tests.** `perf-findings.test.ts` на записанных отчётах: `good.json` (LCP 1800, CLS 0.02, TBT 90, FCP 1200) не даёт `warning`/`error`; `poor.json` (LCP 5200, CLS 0.31, TBT 800, FCP 3400) даёт четыре `warning` в порядке `perf/cls`, `perf/fcp`, `perf/lcp`, `perf/tbt`; граничные значения: LCP ровно 2500 — тишина, 2501 — `info`, 4000 — `info`, 4001 — `warning`; `perf/opportunity` — не более 5 и отсортирован; `medianLhr` берёт медиану трёх прогонов. `perf.test.ts` с подставным бегуном: два URL, у второго бегун бросает — первый даёт находки, второй `perf/run-failed`, код выхода по `--fail-on warning` равен 1; `loadLighthouseRunner` при отсутствии пакета (имитировать подменой загрузчика) → `UsageError` с текстом `npm i -D lighthouse chrome-launcher` (**Review Focus 6**); `--format json` содержит `perf/*`, `rules explain perf/lcp` печатает описание.
- [ ] **Step 2: Run** `npx vitest run tests/unit/perf-findings.test.ts tests/e2e/perf.test.ts` — падают.
- [ ] **Step 3: Implement.** `loadLighthouseRunner`: `import("lighthouse")` и `import("chrome-launcher")` внутри `try`; при неудаче повторить через `createRequire(<cwd>/)` (пакет стоит в проекте пользователя); запуск Chrome `--headless=new` (+ `--no-sandbox` по флагу), порт из `chrome-launcher`, `onlyCategories: ["performance"]`, `formFactor` и `screenEmulation` по пресету, Chrome всегда закрывается в `finally`. Для записи фикстур LHR один раз снять реальный отчёт и урезать до `LhrSubset` (вручную проверить, что в файле нет путей домашнего каталога).
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck`. Затем один **ручной дымовой прогон** (не часть CI): `npm i --no-save lighthouse chrome-launcher`, `npx serve`-подобная раздача фикстуры `good` через `tests/support/server.ts`, `node dist/cli.js perf http://127.0.0.1:<порт>/ --no-sandbox`; результат (метрики и что Lighthouse не упал) записать в ledger. Если Chrome недоступен — записать, что шаг пропущен и почему.
- [ ] **Step 5: Commit** `feat(perf): Lighthouse-based perf command`.

---

### Task 9: Документация, версия 0.2.0, проверка на сайте Виктора

**Files:**
- Modify: `README.md`, `package.json` (версия `0.2.0`), `src/version.ts`, `docs/rules.md` (регенерация), `NOTICE` (Lighthouse и chrome-launcher упомянуты как необязательные Apache-2.0 зависимости), `.github/workflows/ci.yml` (без изменений, если нечего менять)

- [ ] **Step 1: README.** Разделы: «URL-режим» (когда нужен, `check http://localhost:4321`, соответствие хостов при боевом `config.site`, лимиты и флаги, `--respect-robots`, предупреждение о чужих сайтах, что JS не выполняется); «Производительность» (`perf`, установка необязательных зависимостей, требование Node ≥ 22.19 для Lighthouse, `--no-sandbox` в контейнерах, что метрики лабораторные и недетерминированные); обновить список возможностей и «чего нет» (research, gsc — план 3).
- [ ] **Step 2: Версия и сборка.** Поднять версию до `0.2.0`; `npm run build && npm run docs:rules`; тест `package.test.ts` (чистая установка из `npm pack`) проходит.
- [ ] **Step 3: Проверка на реальном сайте.** Собрать сайт Виктора (`site/`, из worktree `~/Projects/viktor-company-hub-mielikki` или актуального `main` хаба), раздать `dist` через `tests/support/server.ts` с `slash: "redirect"` и прогнать `node dist/cli.js check http://127.0.0.1:<порт> --config <site/mielikki.config.yaml>` и тот же `check` по папке; сравнить находки, расхождения разобрать (баг Mielikki — исправить; особенность раздачи — записать). В ledger записать итог. В репозитории хаба ничего не менять и не пушить.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** `docs: URL mode and perf, release 0.2.0`.

---

## Self-review (выполнено при составлении)

- **Покрытие спеки:** 7.1 URL (обход, localhost/частные адреса, лимиты, заголовки, редиректы) — задачи 2–5; раздел 8 «http» (коды, цепочки, HTTPS, единая форма адреса, заголовки безопасности, сжатие, кэш, мягкие 404) — задачи 6–7; раздел 9 `perf` — задача 8; раздел 10 (сетевые части без живой сети) — loopback и `scriptedFetcher`; раздел 5 (безопасность обхода: чужие хосты, лимиты размера/страниц/времени) — Global Constraints и RF 1–2. Что осознанно не входит: Trends/competitors/gsc (план 3), JS-рендеринг (решено в спеке 13).
- **Согласованность типов:** `FetchRecord`/`Hop`/`Fetched` определены в задаче 1 и используются в 2–7 без изменений; `scriptedFetcher` строится в задаче 3 и переиспользуется в 4–7; `NOT_FOUND_PROBE` определён в задаче 4 и читается правилом задачи 7.
- **Пропорции:** 9 задач против 18 в плане 1; новых правил 17 (+6 `perf/*` метаданных), каждое — в таблице с условием, а не с кодом.
