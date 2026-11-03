# Mielikki

Local SEO audit CLI for built static sites. Point it at a build directory (`dist/`) or a running site, get a list of concrete problems with fixes. `check` is deterministic (the same files, or the same server responses, give the same report), has no telemetry and no overall score. Directory mode never touches the network; URL mode crawls only the site you point it at; `perf` loads the pages you name in headless Chrome.

> **Status: pre-1.0 (0.2.0).** Three ways to audit: `check <dir>` reads a built site from disk (offline, deterministic); `check <url>` crawls a running site over HTTP and applies the same rules plus HTTP-specific ones (status codes, redirects, headers, compression, caching); `perf` measures pages with Lighthouse. Two data commands feed the work around the audit: `research` (Google suggestions, trends, competitor structure; see [docs/research.md](docs/research.md)) and `gsc` (Search Console, read-only, your own OAuth client; see [docs/gsc.md](docs/gsc.md)). JavaScript is never executed: Mielikki audits the HTML the server sends.

Mielikki is built for small local-business sites (it ships with Finnish, Swedish and English language support, deepest for Finnish) but the checks are generic: robots.txt and sitemap, titles and headings, canonicals, links, images, structured data, NAP consistency, target queries and more.

## Install

Until the package is published to npm, install from git:

```sh
npm i -D github:KostyaKarrera/mielikki
npx mielikki --help
```

The compiled `dist/` is not committed: on a git install npm runs the package's `prepare` script (`npm run build`), which compiles it with the package's own dev dependencies. Installing with `--ignore-scripts` skips that step and leaves no CLI.

After the npm release: `npx mielikki ...`. Requires Node.js 22.12 or newer.

## Quick start

```sh
npx mielikki init dist      # writes mielikki.config.yaml, detecting language, site URL and business schema from the build
npx mielikki check dist     # prints findings; exit code 1 if any error
```

`init` only guesses; review the generated file. It never writes a local or private origin (localhost, 192.168.x.x, ...) as `site:`. `check` without an argument uses `input.dir` from the config.

The input directory is read as plain files: symbolic links (files and directories) are skipped silently, so a build that symlinks pages in will look incomplete.

## Configuration

`mielikki.config.yaml` in the project root (validated; errors name the offending field). Example, trimmed:

```yaml
site: https://example.fi
language: fi # fi | sv | en; detected from <html lang> if omitted
region: FI # reserved for future use; no rule reads it yet
prelaunch: true # the site is intentionally closed for now
input:
  dir: dist
  trailingSlash: always # always | never | ignore
business:
  type: service-area # brick-and-mortar | service-area | hybrid
  schemaType: Electrician
  name: Example Sähkö Oy
  phone: "+358 41 000 0000"
  areaServed: [Loviisa, Porvoo, Helsinki, Uusimaa]
  hasReviews: false # aggregateRating/Review in schema without real reviews is an error
exclude:
  noindexExpected: [/kiitos/, /404/]
placeholders: [MALLITEKSTI, lorem ipsum]
testContacts: # added to the built-in test phone/email patterns
  phones: ['^\+?358 ?40 ?000']
  emails: ['@example\.']
targets:
  required: [/, /palvelut/*, /alueet/*]
  pages:
    - url: /palvelut/sahkoasennukset/
      primary: sähköasennukset loviisa
      secondary: [sähköasentaja loviisa, sähkömies porvoo]
      forms: { helsinki: [helsingissä, helsingin] }
rules:
  disable: [images/modern-format]
  severity: { content/word-count: info }
```

Target queries are matched by word stem (Snowball stemmers for fi, sv, en) plus the explicit `forms` from the config. See `tests/fixtures/sites/good` for a complete small example.

## Profiles

- `dev` (default): everyday checking. Rules report their own severity. With `prelaunch: true`, findings caused by the site being intentionally closed (noindex, `Disallow: /`) are downgraded to info.
- `launch`: pre-release gate. Rules marked launch-blocking (closed to indexing, `site:` not configured, localhost/private URLs in canonicals or sitemaps, missing or broken robots/sitemap, bad canonicals, broken internal links, placeholders and test contacts, invalid JSON-LD, fake ratings, missing title/H1, uncovered target pages and similar) are raised to `error`. Override per rule with `rules.launchBlocking`.

```sh
mielikki check dist --profile launch --fail-on warning
```

Options: `--config <path>`, `--profile dev|launch`, `--format text|json|md`, `--output <file>`, `--fail-on error|warning|info`, `--rules <mask,...>` (e.g. `crawl/*,core/title-*`), `--min-severity` (text format).

## URL mode

```sh
npx mielikki check http://localhost:4321/          # a dev/preview server
npx mielikki check https://sahko.example/ --max-pages 50
```

Use it when you need what only a live server shows: HTTP status codes and redirect chains, http/www/trailing-slash variants, security headers, compression, caching, soft 404s. `check` with an `http://` or `https://` argument crawls the site instead of reading files: robots.txt, sitemaps, then pages level by level from the start URL, only on that host, then the referenced assets (`HEAD`, retried as `GET` when the server answers 403, 405 or 501). It applies the same rules as directory mode, plus the `http/*` rules and `links/redirected`. Results do not depend on response timing: the same server responses give a byte-identical report.

What the crawl does and does not do:

- JavaScript is not executed. Only server-sent HTML is analysed; links, redirects and content added by scripts are invisible (for example a form that redirects to `/kiitos` via JS).
- Only links found in the HTML and URLs listed in sitemaps are followed. Configured `targets.pages` URLs are also requested. Any other page that nothing links to and no sitemap lists is not discovered; directory mode finds it because it reads every file.
- URLs with a query string are not crawled; the start URL is the exception (it is requested as given, and the report root drops the query).
- A link, image or target page is reported as broken or missing only when it was requested and answered with status 400 or above or did not answer (timeout, network error, too large). A URL that redirects is not broken (`links/redirected` and `http/redirect-chain` report redirects). A link or image URL that was never requested (beyond `--max-pages` or `--max-assets`, a query URL, skipped by `--respect-robots`) is not reported. A target page that was not found is reported unless the crawl was cut by `--max-pages` or skipped its URL; `http/crawl-limit` says when the page limit cut the crawl.
- A start URL that answers with status 400 or above is a usage error (exit 2), as are credentials in the URL, a start URL that is a file (`.xml`, `.jpg`, ...) and an unreachable start URL.
- A start URL that redirects to another origin (`http://` to `https://`, apex to `www.`, another port or host) is a usage error (exit 2) naming the target: start from the final URL, for example `https://www.example.fi/`.

### Hostname mapping and `config.site`

The site origin used for canonicals, sitemaps and hreflang is `site:` from the config; without it, it is detected from the canonicals found on the pages (as in directory mode), and failing that the crawl origin is used. The host mapping is driven by `config.site` alone and is never auto-detected: when the crawl host differs from `config.site` (typically an audit of `http://localhost:4321` with the production `site: https://example.fi`), URLs on the `config.site` host are mapped onto the crawl host, so a canonical `https://example.fi/palvelut/` is checked as `http://localhost:4321/palvelut/`. No request is ever made to the `config.site` host; the http/www probe for it is skipped too.

### Limits and flags (ignored for a directory)

`--max-pages <n>` (200), `--max-assets <n>` (300), `--concurrency <n>` (4 for local hosts, 2 otherwise), `--delay <ms>` between requests (0 local, 100 otherwise), `--timeout <ms>` per request (15000; `--delay` and `--timeout` at most 2147483647), `--max-bytes <n>` per response (5000000), `--respect-robots`. At most 10 redirects are followed. User agent: `Mielikki/<version> (+https://github.com/KostyaKarrera/mielikki)`.

`--respect-robots` skips URLs that robots.txt disallows for `*`; the start URL is always requested. It is off by default because a site audit should see the pages the owner wants audited, including a pre-launch site with `Disallow: /`; turn it on when you crawl a site you do not run, or want to see what a bot would see.

### Safety

Only audit sites you own or have permission to audit. For a non-local host other than `config.site`, a warning is printed to stderr.

### Known limitations

- An asset that redirects to another host (for example a CDN redirect) is not followed, so its size and headers are not checked; it is not reported as missing.
- The http/www probes (does `http://` redirect to `https://`, does `www.` resolve) only run for named non-local hosts, not for local hosts or IP addresses.
- `--max-assets` is a single budget for images, scripts, styles, og:image, linked files and sitemap file entries; assets over the budget are not checked at all, so on large sites raise it.

## Performance (`perf`)

```sh
npm i -D lighthouse chrome-launcher     # optional peer dependencies, needed only for perf
npx mielikki perf https://example.fi/ --preset mobile --runs 3
```

`mielikki perf <url...>` runs Lighthouse (performance category only) in headless Chrome against each URL and reports Core Web Vitals style findings: `perf/lcp`, `perf/cls`, `perf/tbt` (a lab proxy for INP), `perf/fcp`, `perf/opportunity`, a reference-only `perf/score`, and `perf/run-failed` when a URL could not be measured (other URLs keep their results). Thresholds follow web.dev: poor is a warning, needs improvement is info. These rules are listed by `rules` but are never run by `check`.

Requirements: Lighthouse 13 needs Node 22.19 or newer, and Google Chrome (found via `chrome-launcher`, the `CHROME_PATH` environment variable or `--chrome-path`). Use `--no-sandbox` in containers and CI. Lighthouse is found next to Mielikki or, failing that, in the current project's `node_modules`. If Lighthouse or Chrome is missing, `perf` exits with code 2 and an install hint.

Flags: `--preset mobile|desktop` (default mobile), `--runs <n>` (median of n runs, default 1), `--chrome-path`, `--no-sandbox`, `--format text|json|md`, `--output <file>`, `--fail-on error|warning|info` (default error), `--config <path>`.

The numbers are lab metrics from a simulated device and network, not field data from real visitors (that is what Search Console and CrUX report). Unlike `check`, perf output is a measurement: it is not deterministic and differs between runs and machines. Use `--runs 3` or more for steadier medians.

## Research and Search Console

```sh
npx mielikki research suggest "sähkömies loviisa" --output research/suggest.json
npx mielikki research trends "sähköasennus" --output research/trends.json
npx mielikki research competitors https://competitor.example/
npx mielikki gsc auth --client client.json
npx mielikki gsc queries --by-target
npx mielikki gsc inspect --limit 100
```

`research` writes data files (json, csv or md) for analysis, for example in Claude Code, before you set `targets` in the config; Google Trends is an unofficial source and may stop working. `gsc` reads your own Search Console data (queries, URL Inspection) with an OAuth client you create yourself. Details, limits and setup: [docs/research.md](docs/research.md), [docs/gsc.md](docs/gsc.md). Research output and the cache (`.mielikki/`, add it to `.gitignore`) are local; only `check <dir>` is fully offline.

## Network and privacy

There is no telemetry. Which command talks to whom:

| Command                                  | Hosts contacted                                                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `check <dir>`, `rules`, `init`           | none                                                                                                                                           |
| `check <url>`                            | the audited site only                                                                                                                          |
| `perf`                                   | the audited URL (through local Chrome)                                                                                                         |
| `research suggest`                       | `suggestqueries.google.com`                                                                                                                    |
| `research trends`                        | `trends.google.com`                                                                                                                            |
| `research competitors`                   | the sites you give                                                                                                                             |
| `gsc auth`, `gsc inspect`, `gsc queries` | `accounts.google.com`, `oauth2.googleapis.com`, `searchconsole.googleapis.com`, `www.googleapis.com`, plus your site's sitemap (`gsc inspect`) |

The Search Console token is stored outside the project in `$XDG_CONFIG_HOME/mielikki/` (mode 0600).

## Exit codes

| Code | Meaning                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| 0    | No findings at or above `--fail-on` (default `error`)                                                                          |
| 1    | At least one finding at or above `--fail-on`                                                                                   |
| 2    | Usage or configuration error (bad flag, invalid config, missing input directory or no HTML files in it, unreachable start URL) |

## Use with Claude Code

`--format json` gives a versioned (`schemaVersion`), stably ordered report meant for an AI agent: every finding has `ruleId`, `severity`, `url`, `message` and a `fix`.

```sh
mielikki check dist --format json --output mielikki-report.json
```

Then ask the agent to read the report and fix the findings, re-running the check afterwards. `mielikki rules explain <id>` describes a single rule, `mielikki rules --format json` lists all of them.

## Rules

The full generated list is in [docs/rules.md](docs/rules.md) (regenerate with `npm run docs:rules`). Categories:

| Category | What it covers                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------- |
| crawl    | robots.txt, sitemap, noindex, canonical targets, depth, orphan pages                                      |
| core     | title, meta description, H1 and heading order, canonical, lang, charset                                   |
| links    | broken internal links, anchors, dead ends, trailing slash                                                 |
| content  | text volume, near-duplicates, placeholders, test contacts, keyword stuffing                               |
| schema   | JSON-LD validity and validation, business type, NAP vs config, areaServed, fake ratings, deprecated types |
| local    | consistent phone and name, `tel:` links, swap test for area pages                                         |
| targets  | target queries in title, H1, intro, description; cannibalization; missing targets                         |
| images   | alt, dimensions, weight, broken files, modern formats, lazy loading                                       |
| social   | Open Graph and Twitter card                                                                               |
| i18n     | `lang` vs config language, hreflang                                                                       |
| mobile   | viewport, zoom                                                                                            |
| legal    | privacy policy and contact page                                                                           |
| a11y     | button names, form labels                                                                                 |
| ai       | AI crawler access in robots.txt (informational)                                                           |

### Rule overlap

One problem is reported once, by the most specific rule; rules that depend on it stay silent:

- `targets/primary-in-title`, `-h1`, `-intro`, `-description` say nothing when the element itself is missing (`core/title-missing`, `core/h1-missing`, `core/description-missing` report that).
- Indexing problems of configured target pages (noindex, robots.txt Disallow, canonical elsewhere) come from `targets/not-indexable`; `crawl/noindex`, `crawl/robots-blocks-page` and `crawl/canonical-target` skip those pages. A site-wide `Disallow: /` is reported only by `crawl/robots-blocks-all`.
- `crawl/robots-no-sitemap` is silent when there is no sitemap at all (`crawl/sitemap-missing`).
- `content/near-duplicate` leaves pairs of area pages to `local/swap-test` (when `business.areaServed` is set). Both rules, and `core/title-duplicate` / `core/description-duplicate`, report one finding per group of similar pages (on the first page, with all pages in `details.pages`), not one per pair.
- `targets/missing-target` without `targets.required` is a warning that never blocks launch.

## Acknowledgements

Many rules and thresholds are derived from [claude-seo](https://github.com/AgriciDaniel/claude-seo) by AgriciDaniel (MIT) and [squirrelscan](https://github.com/squirrelscan/squirrelscan) (MIT), plus Google Search Central documentation. See [NOTICE](NOTICE) for details, including bundled schema.org data (CC BY-SA 3.0).

## Development

```sh
npm ci
npm run lint && npm run typecheck && npm test
npm run docs:rules   # regenerate docs/rules.md after changing rule metadata
```

## License

MIT. See [LICENSE](LICENSE).
