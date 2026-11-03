# `mielikki gsc`

Read-only access to your own Google Search Console data: `auth`, `inspect` (URL Inspection) and `queries` (Search Analytics). Mielikki has no shared Google client: you create your own OAuth client, so quotas and consent belong to you. Nothing is sent anywhere except Google (and your own site's sitemap).

## Set up your own OAuth client

1. Create a project in the [Google Cloud console](https://console.cloud.google.com/).
2. APIs & Services, Library: enable the **Google Search Console API**.
3. OAuth consent screen: user type External, publishing status **Testing**, and add yourself under **Test users**.
4. Credentials, Create credentials, **OAuth client ID**, application type **Desktop app**.
5. Download the JSON file.
6. `mielikki gsc auth --client client.json` opens a browser (or prints a link with `--no-open`), you consent, and Mielikki stores a refresh token.

Mielikki rejects a client JSON whose `auth_uri` is not on `accounts.google.com` or whose `token_uri` is not `oauth2.googleapis.com` (a security check: the token exchange must go to Google).

**Refresh tokens expire after 7 days in Testing mode.** Verified in Google's OAuth 2.0 documentation (https://developers.google.com/identity/protocols/oauth2, checked 2026-11-03): a project with an external consent screen in the "Testing" status gets a refresh token that expires in 7 days (unless only the openid, email and profile scopes are requested, which is not the case here). This applies to your own OAuth client in Testing mode, not to a token from gcloud (`--adc`). Run `gsc auth` again when the commands report that access is gone, or move the consent screen to production; Google's consent-screen help (https://support.google.com/cloud/answer/13463073, checked 2026-11-03) says apps requesting sensitive scopes must complete OAuth app verification before being granted access; that page does not describe Testing mode, so the test-user setup here relies on the Testing-mode rules cited above.

### Alternative: Application Default Credentials

If you use `gcloud`:

```sh
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/webmasters.readonly,https://www.googleapis.com/auth/cloud-platform
mielikki gsc auth --adc
```

`inspect` and `queries` also fall back to ADC on their own when no token is stored (`GOOGLE_APPLICATION_CREDENTIALS` or the gcloud file), without a prior `gsc auth --adc`; in that case nothing is copied into Mielikki's store. `--adc` copies gcloud's refresh token into Mielikki's own store (0600). The scope is verified; if `webmasters.readonly` is missing you get the command above. The copy goes stale if you log in with gcloud again; repeat `gsc auth --adc`.

## Where the token lives

`$XDG_CONFIG_HOME/mielikki/gsc-token.json` (default `~/.config/mielikki/gsc-token.json`), file mode 0600, directory 0700. Never in the project, so it cannot be committed. Access tokens are kept in memory only. `mielikki gsc auth --logout` deletes the local file only: the grant stays valid until you revoke it at https://myaccount.google.com/permissions. For `adc` gcloud's own copy is untouched.

## `siteUrl`

`--site` is the Search Console property exactly as listed there: a URL-prefix property such as `https://example.fi/` (trailing slash) or a domain property `sc-domain:example.fi`. Default: `config.site` with a trailing slash. If your property is a domain property, pass `--site sc-domain:example.fi`.

## `gsc inspect`

URL Inspection for the pages of your sitemap (`/sitemap.xml` of `config.site`, same origin only, sitemap indexes followed) or of `targets.pages` (`--from targets`). Columns: `url`, `verdict`, `coverageState`, `indexingState`, `robotsTxtState`, `pageFetchState`, `googleCanonical`, `userCanonical`, `lastCrawlTime`. A summary of non-PASS pages goes to stderr.

- `--limit <n>` (default 200, at most 2000) caps the pages; the rest are reported as not checked.
- **Quotas.** Per Google's Search Console API usage limits (https://developers.google.com/webmaster-tools/limits, checked 2026-11-03), the URL Inspection API allows 2,000 queries per day and 600 per minute per site (property), and 10,000,000 per day and 15,000 per minute per project. Mielikki pauses 100 ms between requests (at most about 10 requests a second) and stops at the first quota answer.
- On a quota stop the rows collected so far are still written and the exit code is 1. The limits are per day; Google's limits page does not state the exact reset time, so retry the next day. Five consecutive failures (5xx or network) stop the run. Any failed request (listed in `errors`) makes the exit code 1, even if the run finishes.

## `gsc queries`

Search Analytics rows (`query`, `page`, `clicks`, `impressions`, `ctr`, `position`), sorted by impressions.

- Search Console data lags about 2 days: the period ends two days ago. `--days <n>` (default 28, at most 480).
- `--row-limit <n>` (default 1000, at most 100000) is fetched in pages of 25000 per request. If the limit is reached a truncation warning is printed: raise `--row-limit`.

### `--by-target`

Matches the queries to `targets.pages` and writes one row per target with columns `target`, `primary`, `status`, `queries`, `impressions`, `clicks`, `bestPosition`, `topQueries` (top 5), `otherPages` (up to 3). The json file keeps `kind: gsc-queries` and an `errors` array that is always empty; the per-query `matched` list is dropped. `status`:

- `ranking`: matched queries were shown with the target page itself.
- `other-page`: queries match, but only other pages of the site ranked for them (candidate for cannibalization or a missing page).
- `no-data`: no query matches (not shown in the period or too little data).

Matching is stem-based, like `check`: every stem of `primary` must occur among the stems of the query. Near-equal stems are accepted within bounds, so `sähköasennus` matches `sähköasennukset`. Caveat: a stem that is a prefix of a longer compound can over-match (`sähköasennus` also matches `sähköasennuslupa`). Use `forms` in the config to add forms that stemming misses; it does not remove over-matches, so read `topQueries`.

No authenticated response is ever cached; every run asks Google again.
