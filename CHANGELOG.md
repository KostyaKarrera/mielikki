# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [1.0.0]

First stable release. The rule catalogue now has 108 rules (list: [docs/rules.md](docs/rules.md)); 23 of them are specific to URL mode (16 `http/*`) and `perf` (7 `perf/*`).

### Added

- `check <dir>`: deterministic audit of a built static site from disk, with text, json and md reports, `--fail-on`, `--rules` masks and exit codes 0/1/2.
- `init`: writes a starter `mielikki.config.yaml`, detecting language, site URL and business schema from the build.
- Launch profile (`--profile launch`): raises launch-blocking rules to `error`; `prelaunch: true` downgrades findings caused by an intentionally closed site in the `dev` profile.
- URL mode (`check <url>`): crawls a running site and applies the same rules plus HTTP rules (status codes, redirects, headers, compression, caching); `--respect-robots` is opt-in.
- `perf`: Lighthouse measurements of the pages you name, with `perf/*` rules. `lighthouse` and `chrome-launcher` are optional peer dependencies.
- `research suggest`, `research trends`, `research competitors`: Google suggestions, Google Trends and competitor structure, written as json, csv or md. See [docs/research.md](docs/research.md).
- `research trends` (experimental): uses Google Trends' unofficial web endpoints; Google may answer 429 or change the format without notice, in which case the command exits 1 and nothing else is affected.
- `gsc auth`, `gsc inspect`, `gsc queries`: read-only Search Console access with your own OAuth client; the token is stored outside the project. See [docs/gsc.md](docs/gsc.md).
- `rules`: prints the rule catalogue (`--format md` generates `docs/rules.md`).
- Rules covering core metadata, crawlability, links, images, structured data and NAP consistency, social tags, accessibility, mobile, legal pages, local SEO, content and target queries, with Finnish, Swedish and English language support.

### Notes

- No telemetry. Only `check <dir>`, `rules` and `init` work fully offline; every other command contacts the hosts listed in the README section "Network and privacy".
- JavaScript is never executed: Mielikki audits the HTML the server sends.
- Requires Node.js 22.12 or newer.
