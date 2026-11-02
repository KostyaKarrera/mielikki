import { formProbeUrls } from "../../load/probes.js";
import type { SiteRule } from "../types.js";
import { isRedirectStatus } from "./_helpers.js";

export const rule: SiteRule = {
  meta: {
    id: "http/https-redirect",
    title: "HTTP does not redirect permanently to HTTPS",
    category: "http",
    severity: "warning",
    scope: "site",
    inputs: ["url"],
    launchBlocking: true,
    fix: "Redirect http:// to the same path on https:// with a 301 or 308.",
    source: "https://developers.google.com/search/docs/crawling-indexing/https",
  },
  checkSite(ctx) {
    const { site } = ctx;
    const probe = formProbeUrls(site.input.root).find((u) =>
      u.startsWith("http:"),
    );
    if (probe === undefined) return;
    const rec = site.responses?.get(probe);
    if (rec === undefined) return;
    // Probes are not followed: the redirect itself is the final answer.
    const f = rec.final;
    let ok = false;
    if (f !== undefined && (f.status === 301 || f.status === 308)) {
      const target = f.headers.location;
      if (target !== undefined && URL.canParse(target, probe)) {
        const t = new URL(target, probe);
        ok = t.protocol === "https:" && t.pathname === new URL(probe).pathname;
      }
    }
    if (ok) return;
    const what =
      rec.stop !== undefined
        ? `does not answer (${rec.stop})`
        : rec.final !== undefined && !isRedirectStatus(rec.final.status)
          ? `answers ${rec.final.status} instead of redirecting`
          : `does not redirect with 301 or 308 to https://`;
    ctx.report({ url: probe, message: `${probe} ${what}` });
  },
};
