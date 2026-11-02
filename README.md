# Mielikki

Local, offline SEO audit CLI for built static sites. Point it at a build directory (`dist/`), get a list of concrete problems with fixes. Deterministic, no telemetry, no overall score. Directory mode never touches the network; URL mode crawls only the site you point it at.

> **Status: pre-1.0.** Directory mode (`check`, `rules`, `init`) works; URL mode (`check <url>`) crawls a running site and applies the same rules (HTTP-specific checks are still to come). Not implemented yet, planned in later releases: `perf` (Lighthouse), `research` (Google suggestions, trends, competitors) and `gsc` (Search Console). Those commands do not exist yet.

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
  phone: "+358 41 555 0142"
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

`check` with an `http://` or `https://` argument crawls the site instead of reading files: robots.txt, sitemaps, then pages level by level from the start URL, only on that host (URLs on `config.site` are mapped to it), then the referenced assets (`HEAD`). Pages that nothing links to and no sitemap lists are not found, unlike in directory mode. Results do not depend on response timing.

Crawl limits (ignored for a directory): `--max-pages <n>` (200), `--max-assets <n>` (300), `--concurrency <n>` (4 for local hosts, 2 otherwise), `--delay <ms>` between requests (0 local, 100 otherwise), `--timeout <ms>` per request (15000), `--max-bytes <n>` per response (5000000), `--respect-robots` (skip URLs disallowed for `*`). At most 10 redirects are followed. User agent: `Mielikki/<version> (+https://github.com/KostyaKarrera/mielikki)`.

Only audit sites you own or have permission to audit: for a non-local host other than `config.site`, a warning is printed to stderr. A start URL with credentials, a start URL that is a file (`.xml`, `.jpg`, ...) and an unreachable start URL (network error, timeout, HTTP 4xx/5xx) are usage errors (exit 2).

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
