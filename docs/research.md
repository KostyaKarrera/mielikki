# `mielikki research`

Keyword and market research that produces **data files**, not verdicts. Mielikki fetches and normalises the data; the analysis (which queries matter, which pages to write) is done afterwards, for example by an AI agent such as Claude Code reading the files.

## Workflow

1. `research suggest` / `trends` / `competitors` write data files (json, csv or md).
2. Read and analyse the files (in Claude Code or by hand): pick the queries worth targeting.
3. Put the result into `targets.pages` in `mielikki.config.yaml` (`primary`, `secondary`, `forms`).
4. `mielikki check` verifies that the pages actually use those queries.

```sh
npx mielikki research suggest "sähkömies loviisa" --output research/suggest.json
npx mielikki research trends "sähköasennus" "led-valaistus" --output research/trends.json
npx mielikki research competitors https://competitor.example/ --output research/competitors.json
```

## Data file format

Every command writes the same envelope (json):

| Field    | Content                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------- |
| `kind`   | `suggest`, `trends`, `competitors` (the `gsc` commands use `gsc-queries` and `gsc-inspect`)       |
| `meta`   | `generatedAt`, `version` and the `params` used. Omitted with `--no-meta` (reproducible output)    |
| `rows`   | the data; columns depend on `kind`                                                                |
| `errors` | partial failures (`source`, `target`, `message`); a run that partly failed still writes its rows  |
| `summary`| `trends` only (see below)                                                                         |

Common flags: `--format json|csv|md` (default json), `--output <file>` (stdout otherwise), `--no-meta`, `--config <path>`. `csv` and `md` hold the same rows as one table; they have no `meta`, `errors` or nested fields.

## Cache

`suggest` and `trends` cache answers in `.mielikki/cache` of the current directory for 7 days. `--refresh` ignores cached answers (and stores the new ones), `--no-cache` neither reads nor writes the cache. `competitors` and the `gsc` commands do not use it (no authenticated response is ever cached). Add `.mielikki/` to `.gitignore`; `mielikki init` prints this advice.

## Politeness and limits

All commands send a `Mielikki/<version>` user agent with a link to the project, pause between requests and have timeouts and response size limits. The sources are not official APIs (apart from Search Console), so keep volumes small and do not run them in loops.

## `research suggest`

Google Suggest autocomplete (`suggestqueries.google.com`) for seed phrases: `suggest <seeds...>` or `--from-config` (every `primary` and `secondary` of `targets.pages`). Rows: `seed`, `expansion`, `query`, `rank`.

- `--expand none|alphabet|questions|both` (default `alphabet`): `alphabet` appends each letter a-z (plus å, ä, ö for Finnish and Swedish) to the seed; `questions` prepends question words of the language (for Finnish `miten`, `mikä`, `paljonko`, `kuinka paljon`, `mitä maksaa`, `kuka`, `missä`).
- `--hl` and `--gl` default to the config `language` and `region` (`--gl` falls back to `hl` when no region is configured); `--delay <ms>` between requests (400; `0` is allowed, but the default is the polite choice and Google may answer 429 sooner without a pause).
- Local queries give sparse data: `sähkömies porvoo` returns about two suggestions. Do not expect volumes from Suggest; bet on long "service + town" queries and use the suggestions as phrasing ideas.
- After 5 consecutive 429/503 answers the remaining requests are skipped (reported in `errors`). If every request fails, the command exits 1.

## `research trends`

Google Trends interest over time (`trends.google.com`). Rows: `term`, `weekStart`, `value` (0-100, relative interest, not search volume).

**Trends is an UNOFFICIAL source.** It may break at any time or answer with 429 or a consent page. Then the command fails cleanly with exit 1 and a message, and nothing else is affected. Each run first opens the Trends page once to obtain the session cookie Google requires (kept in memory only, sent to trends.google.com only, never cached or printed) and pauses at least 1 s between consecutive requests. If a group after the first fails, the groups already fetched are kept, the failure goes to `errors`, and the exit code is 0.

- `--geo` and `--hl` default to the config `region` and `language`; `--timeframe` (default `today 5-y`). For timeframes that are not weekly (such as `now 7-d`), `weekStart` holds the full timestamp of the point.
- Google allows 5 terms per request. More terms are fetched in groups of 5 that share the first term as an anchor, and later groups are rescaled by the sums of the anchor, so values from different groups are comparable only approximately (they may exceed 100; 1 decimal). If the anchor has no interest in a group, that group is reported as "not comparable" in `errors`.
- `summary` (json and md only; csv prints a notice): per term `average`, `peakMonth` (1-12) and `seasonality` (12 monthly averages scaled so the maximum is 100).

## `research competitors`

Structure of competitor sites: `competitors <url...>`. It is a polite crawler. **Use it only on sites you are allowed to read.**

- robots.txt is always obeyed (there is no switch to turn it off). `--delay` (500 ms) sets the pause (`0` is allowed; the default is the polite choice). A `Crawl-delay` in robots.txt for `*` or `Mielikki` is honoured: the pause between requests to that site is the larger of `--delay` and the Crawl-delay, capped at 10 s.
- Only same-origin redirects (scheme, host and port) are followed. At most `--max-pages` pages per site (30, upper bound 1000); the start page is taken first, then the sitemap URLs.
- `--language fi|sv|en` selects the stemmer for `terms` (default: config language).
- The json report per site holds `sitemapUrls`, `pagesAnalyzed`, `stoppedBy` (`done` or `max-pages`), `urlPatterns` (path patterns with counts), `pages` (url, title, H1/H2, `schemaTypes`, word count, `kind`: home/service/area/other, depth), `terms` (stems found across pages) and `errors`.
- `csv` and `md` flatten each site to one row (`site`, `sitemapUrls`, `pagesAnalyzed`, `stoppedBy`, `notes`); `notes` holds the first error if no page was fetched, or the number of errors. Use json for the detail.
- The top-level `errors` of a competitors file is always `[]`; errors are per site, inside each row.
- Exit 1 if no page could be fetched from any site. Pages nested deeper than 1500 elements are not parsed; each is recorded as an error and the crawl continues.
