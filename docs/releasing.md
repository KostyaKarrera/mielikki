# Releasing

Publishing is done only by the owner, or on the owner's explicit confirmation. Every step below is marked "owner confirms": nothing here is automatic, and nothing is published until a `v*.*.*` tag is pushed and the `NPM_TOKEN` secret exists.

1. **Verify the name is free** (owner confirms). `npm view mielikki` must answer `E404`. If the name is taken, stop and pick another.
2. **Check the package contents** (owner confirms). `npm pack --dry-run` lists only `dist/`, `vendor/`, `LICENSE`, `NOTICE`, `README.md`, `package.json`. The same is enforced by `tests/e2e/package.test.ts`.
3. **Merge the feature branches into `main` through pull requests** (owner confirms): `feat/plan-2-url-perf` and `feat/plan-3-research-gsc`. CI must be green.
4. **Make sure `package.json` version, `CHANGELOG.md` and the tag agree** (owner confirms). The tag is `v` plus the version, for example `v1.0.0`.
5. **Add the `NPM_TOKEN` repository secret** (owner confirms): an npm automation token that bypasses 2FA, or switch to npm trusted publishing and drop the token. The workflow also needs `id-token: write` for provenance (already set).
6. **Create and push the tag** (owner confirms): `git tag v1.0.0 && git push origin v1.0.0`. This starts `.github/workflows/release.yml`: `npm ci`, lint, typecheck, build, test, then `npm publish --provenance --access public`.
7. **Verify the release** (owner confirms): `npx mielikki@1.0.0 --version` prints `1.0.0`; the package page shows the provenance badge.
8. Optional (owner confirms): create a GitHub Release from the tag; update the pinned Mielikki commit or version in the hub repository.

A published version cannot be replaced. If the release is wrong, publish a new patch version and, if needed, `npm deprecate` the bad one.
