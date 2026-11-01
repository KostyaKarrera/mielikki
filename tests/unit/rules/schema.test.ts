import { describe, expect, it } from "vitest";
import { allRules } from "../../../src/rules/all.js";
import { rule as areaServed } from "../../../src/rules/schema/area-served.js";
import { rule as businessGenericType } from "../../../src/rules/schema/business-generic-type.js";
import { rule as businessMissing } from "../../../src/rules/schema/business-missing.js";
import { rule as deprecated } from "../../../src/rules/schema/deprecated.js";
import { rule as fakeRating } from "../../../src/rules/schema/fake-rating.js";
import { rule as identity } from "../../../src/rules/schema/identity.js";
import { rule as jsonldSyntax } from "../../../src/rules/schema/jsonld-syntax.js";
import { rule as napMismatch } from "../../../src/rules/schema/nap-mismatch.js";
import { rule as validation } from "../../../src/rules/schema/validation.js";
import { runRule, siteFrom } from "../../helpers.js";

const ld = (data: unknown) =>
  `<script type="application/ld+json">${typeof data === "string" ? data : JSON.stringify(data)}</script>`;
const doc = (...blocks: string[]) =>
  `<html lang="fi"><head>${blocks.join("")}</head><body><main><h1>x</h1></main></body></html>`;
const biz = (over: Record<string, unknown> = {}) => ({
  "@context": "https://schema.org",
  "@type": "Electrician",
  name: "Sähkö Oy",
  telephone: "+358 40 123 4567",
  ...over,
});
const business = (over: Record<string, unknown> = {}) => ({
  business: {
    type: "brick-and-mortar" as const,
    schemaType: "Electrician",
    name: "Sähkö Oy",
    phone: "+358401234567",
    areaServed: [],
    hasReviews: false,
    ...over,
  },
});
const run = async (
  rule: Parameters<typeof runRule>[0],
  files: Record<string, string>,
  cfg: Record<string, unknown> = {},
) => runRule(rule, await siteFrom(files, cfg));

describe("registry", () => {
  it("registers the 9 schema rules", () => {
    expect(
      allRules.filter((r) => r.meta.id.startsWith("schema/")),
    ).toHaveLength(9);
  });
});

describe("schema/jsonld-syntax", () => {
  it("fires on broken JSON", async () => {
    const f = await run(jsonldSyntax, { "index.html": doc(ld("{bad")) });
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain("#1");
  });
  it("does not fire on valid JSON", async () => {
    expect(await run(jsonldSyntax, { "index.html": doc(ld(biz())) })).toEqual(
      [],
    );
  });
});

describe("schema/validation", () => {
  const rating = (extra: Record<string, unknown>) =>
    doc(ld(biz({ aggregateRating: { "@type": "AggregateRating", ...extra } })));
  it("reports incomplete aggregateRating as error and optional fields as info", async () => {
    const f = await run(validation, {
      "index.html": rating({ ratingValue: 5 }),
    });
    const err = f.find((x) => x.severity === "error");
    expect(err?.message).toContain("ratingCount");
    expect(err?.details).toMatchObject({ rootType: "Electrician" });
    expect(
      f.some((x) => x.severity === "info" && x.message.includes("bestRating")),
    ).toBe(true);
  });
  it("does not fire without structured data", async () => {
    expect(await run(validation, { "index.html": doc() })).toEqual([]);
  });
  it("has no errors for a complete rating", async () => {
    const f = await run(validation, {
      "index.html": rating({
        ratingValue: 5,
        ratingCount: 3,
        bestRating: 5,
        worstRating: 1,
      }),
    });
    expect(f.filter((x) => x.severity === "error")).toEqual([]);
  });
});

describe("schema/business-missing", () => {
  it("fires when home has no node of the type, ignores config-less", async () => {
    const files = { "index.html": doc(ld({ "@type": "WebSite", name: "x" })) };
    expect(await run(businessMissing, files, business())).toHaveLength(1);
    expect(await run(businessMissing, files)).toEqual([]);
  });
  it("finds the node in @graph and in array types", async () => {
    const graph = {
      "@context": "https://schema.org",
      "@graph": [{ "@type": ["Thing", "Electrician"] }],
    };
    expect(
      await run(businessMissing, { "index.html": doc(ld(graph)) }, business()),
    ).toEqual([]);
  });
});

describe("schema/business-generic-type", () => {
  it("fires on LocalBusiness when a specific type is configured", async () => {
    const f = await run(
      businessGenericType,
      { "index.html": doc(ld({ "@type": "LocalBusiness", name: "x" })) },
      business(),
    );
    expect(f).toHaveLength(1);
  });
  it("does not fire with the specific type or no config", async () => {
    expect(
      await run(
        businessGenericType,
        { "index.html": doc(ld(biz())) },
        business(),
      ),
    ).toEqual([]);
    expect(
      await run(businessGenericType, {
        "index.html": doc(ld({ "@type": "LocalBusiness" })),
      }),
    ).toEqual([]);
  });
});

describe("schema/nap-mismatch", () => {
  it("fires on a different name and phone", async () => {
    const f = await run(
      napMismatch,
      {
        "index.html": doc(ld(biz({ name: "Other Oy", telephone: "050 999" }))),
      },
      business(),
    );
    expect(f).toHaveLength(2);
  });
  it("does not fire when only phone formatting differs", async () => {
    expect(
      await run(napMismatch, { "index.html": doc(ld(biz())) }, business()),
    ).toEqual([]);
  });
  it("does nothing without config.business", async () => {
    expect(
      await run(napMismatch, { "index.html": doc(ld(biz({ name: "Z" }))) }),
    ).toEqual([]);
  });
});

describe("schema/area-served", () => {
  const files = { "index.html": doc(ld(biz())) };
  it("fires for service-area without areaServed", async () => {
    expect(
      await run(areaServed, files, business({ type: "service-area" })),
    ).toHaveLength(1);
  });
  it("does not fire with areaServed, brick-and-mortar, or no config", async () => {
    expect(
      await run(
        areaServed,
        { "index.html": doc(ld(biz({ areaServed: "Espoo" }))) },
        business({ type: "hybrid" }),
      ),
    ).toEqual([]);
    expect(await run(areaServed, files, business())).toEqual([]);
    expect(await run(areaServed, files)).toEqual([]);
  });
});

describe("schema/fake-rating", () => {
  const files = {
    "index.html": doc(
      ld(
        biz({
          aggregateRating: { "@type": "AggregateRating", ratingValue: 5 },
        }),
      ),
    ),
  };
  it("fires when hasReviews is false", async () => {
    const f = await run(fakeRating, files, business());
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain("aggregateRating");
  });
  it("does not fire with hasReviews, nested review ok, or no config", async () => {
    expect(
      await run(fakeRating, files, business({ hasReviews: true })),
    ).toEqual([]);
    expect(await run(fakeRating, files)).toEqual([]);
    expect(
      await run(fakeRating, { "index.html": doc(ld(biz())) }, business()),
    ).toEqual([]);
  });
  it("fires on a nested review", async () => {
    const f = await run(
      fakeRating,
      {
        "index.html": doc(
          ld({ "@graph": [biz({ review: { "@type": "Review" } })] }),
        ),
      },
      business(),
    );
    expect(f).toHaveLength(1);
  });
});

describe("schema/identity", () => {
  it("fires on differing @id or name across pages", async () => {
    const f = await run(
      identity,
      {
        "index.html": doc(ld(biz({ "@id": "https://a.fi/#b" }))),
        "yhteys/index.html": doc(
          ld(biz({ "@id": "https://a.fi/#c", name: "Muu Oy" })),
        ),
      },
      business(),
    );
    expect(f).toHaveLength(2);
  });
  it("does not fire when consistent", async () => {
    const page = doc(ld(biz({ "@id": "https://a.fi/#b" })));
    expect(
      await run(
        identity,
        { "index.html": page, "yhteys/index.html": page },
        business(),
      ),
    ).toEqual([]);
  });
});

describe("schema/deprecated", () => {
  it("fires on HowTo and FAQPage", async () => {
    const f = await run(deprecated, {
      "index.html": doc(ld([{ "@type": "HowTo" }, { "@type": "FAQPage" }])),
    });
    expect(f).toHaveLength(2);
    expect(f.map((x) => x.severity)).toEqual(["info", "info"]);
    expect(f.find((x) => x.message.startsWith("FAQPage"))?.message).toContain(
      "still allowed",
    );
  });
  it("does not fire on other types", async () => {
    expect(await run(deprecated, { "index.html": doc(ld(biz())) })).toEqual([]);
  });
});
