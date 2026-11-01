import { describe, expect, it } from "vitest";
import { rule as buttonName } from "../../../src/rules/a11y/button-name.js";
import { rule as formLabel } from "../../../src/rules/a11y/form-label.js";
import { rule as crawlerAccess } from "../../../src/rules/ai/crawler-access.js";
import { allRules } from "../../../src/rules/all.js";
import { rule as contactPage } from "../../../src/rules/legal/contact-page.js";
import { rule as privacyPolicy } from "../../../src/rules/legal/privacy-policy.js";
import { runRule, siteFrom } from "../../helpers.js";

const doc = (body = "<h1>x</h1>") =>
  `<html lang="fi"><head><title>t</title></head><body><main>${body}</main></body></html>`;
const run = async (
  rule: Parameters<typeof runRule>[0],
  files: Record<string, string>,
  cfg: Record<string, unknown> = {},
) => runRule(rule, await siteFrom(files, { language: "fi", ...cfg }));

describe("registry", () => {
  it("registers the 5 legal/a11y/ai rules", () => {
    const ids = allRules.map((r) => r.meta.id);
    for (const id of [
      "legal/privacy-policy",
      "legal/contact-page",
      "a11y/form-label",
      "a11y/button-name",
      "ai/crawler-access",
    ])
      expect(ids).toContain(id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("legal/privacy-policy", () => {
  it("fires when no privacy link exists", async () => {
    const f = await run(privacyPolicy, { "index.html": doc() });
    expect(f).toHaveLength(1);
    expect(privacyPolicy.meta.launchBlocking).toBe(true);
  });
  it("does not fire when a link text matches", async () => {
    const f = await run(privacyPolicy, {
      "index.html": doc('<a href="/x/">Tietosuojaseloste</a>'),
      "x/index.html": doc(),
    });
    expect(f).toEqual([]);
  });
  it("does not fire when a link path matches", async () => {
    const f = await run(privacyPolicy, {
      "index.html": doc('<a href="/tietosuoja/">Lue</a>'),
      "tietosuoja/index.html": doc(),
    });
    expect(f).toEqual([]);
  });
  it("option path requires that page", async () => {
    const files = {
      "index.html": doc('<a href="/tietosuoja/">Tietosuoja</a>'),
      "tietosuoja/index.html": doc(),
    };
    const cfg = (path: string) => ({
      rules: { options: { "legal/privacy-policy": { path } } },
    });
    expect(await run(privacyPolicy, files, cfg("/privacy/"))).toHaveLength(1);
    expect(await run(privacyPolicy, files, cfg("/tietosuoja/"))).toEqual([]);
  });
});

describe("legal/contact-page", () => {
  it("fires when there is no contact page or link", async () => {
    expect(await run(contactPage, { "index.html": doc() })).toHaveLength(1);
  });
  it("does not fire with a contact link text", async () => {
    const f = await run(contactPage, {
      "index.html": doc('<a href="/x/">Yhteystiedot</a>'),
      "x/index.html": doc(),
    });
    expect(f).toEqual([]);
  });
  it("does not fire with a contact page", async () => {
    const f = await run(contactPage, {
      "index.html": doc(),
      "yhteystiedot/index.html": doc(),
    });
    expect(f).toEqual([]);
  });
});

describe("a11y/form-label", () => {
  it("fires once per page for unlabelled controls", async () => {
    const f = await run(formLabel, {
      "index.html": doc('<form><input type="text"><input type="email"></form>'),
    });
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain("2 form control");
    expect(f[0]?.message).toContain("input[text]");
  });
  it("does not fire when labelled", async () => {
    const f = await run(formLabel, {
      "index.html": doc(
        '<form><label>Nimi <input type="text"></label><input aria-label="x"></form>',
      ),
    });
    expect(f).toEqual([]);
  });
});

describe("a11y/button-name", () => {
  it("fires for a nameless button", async () => {
    const f = await run(buttonName, {
      "index.html": doc("<button></button><button>Lähetä</button>"),
    });
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain("1 button");
  });
  it("does not fire for named buttons", async () => {
    const f = await run(buttonName, {
      "index.html": doc(
        '<button>Lähetä</button><button aria-label="x"></button>',
      ),
    });
    expect(f).toEqual([]);
  });
});

describe("ai/crawler-access", () => {
  const withRobots = (txt: string) => ({
    "index.html": doc(),
    "robots.txt": txt,
  });
  it("is silent without robots.txt", async () => {
    expect(await run(crawlerAccess, { "index.html": doc() })).toEqual([]);
  });
  it("reports all allowed as info", async () => {
    const f = await run(crawlerAccess, withRobots("User-agent: *\nAllow: /\n"));
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("info");
    expect(
      ((f[0]?.details?.allowed as string[] | undefined) ?? []).length,
    ).toBe(11);
    expect(f[0]?.details?.blocked).toEqual([]);
    expect(f[0]?.details?.explicit).toEqual([]);
  });
  it("explicit block of OAI-SearchBot => warning", async () => {
    const f = await run(
      crawlerAccess,
      withRobots("User-agent: oai-searchbot\nDisallow: /\n"),
    );
    expect(f[0]?.severity).toBe("warning");
    expect(f[0]?.details?.blocked).toEqual(["OAI-SearchBot"]);
    expect(f[0]?.details?.explicit).toEqual(["OAI-SearchBot"]);
  });
  it("GPTBot blocked only => info", async () => {
    const f = await run(
      crawlerAccess,
      withRobots("User-agent: GPTBot\nDisallow: /\n"),
    );
    expect(f[0]?.severity).toBe("info");
    expect(f[0]?.details?.blocked).toEqual(["GPTBot"]);
  });
  it("Disallow-all via * => info", async () => {
    const f = await run(
      crawlerAccess,
      withRobots("User-agent: *\nDisallow: /\n"),
    );
    expect(f[0]?.severity).toBe("info");
    expect(
      ((f[0]?.details?.blocked as string[] | undefined) ?? []).length,
    ).toBe(11);
    expect(f[0]?.details?.explicit).toEqual([]);
  });
});
