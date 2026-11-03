import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseConfig } from "../../src/config/schema.js";

const CLI = path.resolve("dist/cli.js");
const run = (args: string[], cwd: string) =>
  spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd });
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "mielikki-init-"));
const page = (head: string) =>
  `<html lang="fi-FI"><head><title>x</title>${head}</head><body>hi</body></html>`;
const BIZ = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Electrician",
  name: "Testi Sähkö Oy",
  telephone: "+358 40 1234567",
  areaServed: ["Loviisa", { "@type": "City", name: "Porvoo" }],
})}</script>`;

function build(pages: Record<string, string>): string {
  const cwd = tmp();
  for (const [rel, html] of Object.entries(pages)) {
    const abs = path.join(cwd, "dist", rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, html);
  }
  return cwd;
}
const read = (cwd: string) =>
  readFileSync(path.join(cwd, "mielikki.config.yaml"), "utf8");

const ld = (o: object) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...o })}</script>`;

describe("init", () => {
  it("prefers a business node over a preceding Service node", () => {
    const cwd = build({
      "index.html": page(
        ld({ "@type": "Service", name: "Wrong" }) +
          ld({ "@type": "Electrician", name: "Right" }),
      ),
    });
    run(["init"], cwd);
    const raw = parse(read(cwd));
    expect(raw.business.schemaType).toBe("Electrician");
    expect(raw.business.name).toBe("Right");
  });

  it("falls back to Organization when no business node exists", () => {
    const cwd = build({
      "index.html": page(ld({ "@type": "Organization", name: "Org Oy" })),
    });
    run(["init"], cwd);
    expect(parse(read(cwd)).business.schemaType).toBe("Organization");
  });

  it("writes no business block for a lone Service node", () => {
    const cwd = build({
      "index.html": page(ld({ "@type": "Service", name: "Svc" })),
    });
    run(["init"], cwd);
    expect(parse(read(cwd)).business).toBeUndefined();
  });

  it("node with streetAddress is brick-and-mortar", () => {
    const cwd = build({
      "index.html": page(
        ld({
          "@type": "Plumber",
          name: "P",
          address: { "@type": "PostalAddress", streetAddress: "Katu 1" },
        }),
      ),
    });
    run(["init"], cwd);
    expect(parse(read(cwd)).business.type).toBe("brick-and-mortar");
  });

  it("--schema-type alone writes a round-tripping business block", () => {
    const cwd = build({ "index.html": page("") });
    run(["init", "--schema-type", "Electrician"], cwd);
    const raw = parse(read(cwd));
    expect(() => parseConfig(raw)).not.toThrow();
    expect(raw.business.schemaType).toBe("Electrician");
    expect(raw.business.name).toBe("");
  });

  it("existing config fails before any directory warning", () => {
    const cwd = tmp();
    writeFileSync(path.join(cwd, "mielikki.config.yaml"), "old: 1\n");
    const r = run(["init", "nodir"], cwd);
    expect(r.status).toBe(2);
    expect(r.stderr).not.toContain("not found");
  });

  it("generates valid config with detected language and site", () => {
    const cwd = build({
      "index.html": page('<link rel="canonical" href="https://testi.fi/">'),
    });
    const r = run(["init"], cwd);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      "wrote mielikki.config.yaml\ntip: add .mielikki/ to .gitignore (research cache lives there)\n",
    );
    const raw = parse(read(cwd));
    expect(() => parseConfig(raw)).not.toThrow();
    expect(raw.language).toBe("fi");
    expect(raw.site).toBe("https://testi.fi");
    expect(raw.targets.required).toEqual(["/"]);
    expect(read(cwd)).toContain("must have a target query");
    expect(read(cwd)).not.toContain("cleanUrls");
    expect(raw.business).toBeUndefined();
    expect(read(cwd)).toContain("# ");
  });

  it("never writes a detected local/private origin as site", () => {
    for (const origin of ["http://localhost:4321", "http://192.168.1.5:8080"]) {
      const cwd = build({
        "index.html": page(`<link rel="canonical" href="${origin}/">`),
      });
      expect(run(["init"], cwd).status).toBe(0);
      const text = read(cwd);
      const raw = parse(text);
      expect(raw.site, origin).toBeUndefined();
      expect(text).toContain('# site: "https://example.fi"');
      expect(text).toContain(`# Detected ${origin} is a local address`);
      expect(() => parseConfig(raw)).not.toThrow();
    }
  });

  it("refuses overwrite with exit 2 and --force overwrites", () => {
    const cwd = build({ "index.html": page("") });
    writeFileSync(path.join(cwd, "mielikki.config.yaml"), "old: 1\n");
    const r = run(["init"], cwd);
    expect(r.status).toBe(2);
    expect(r.stderr.trim()).toBe(
      "mielikki: mielikki.config.yaml already exists (use --force to overwrite)",
    );
    expect(read(cwd)).toBe("old: 1\n");
    expect(run(["init", "--force"], cwd).status).toBe(0);
    expect(() => parseConfig(parse(read(cwd)))).not.toThrow();
  });

  it("all pages noindex gives prelaunch", () => {
    const m = '<meta name="robots" content="noindex">';
    const cwd = build({ "index.html": page(m), "a/index.html": page(m) });
    run(["init"], cwd);
    const raw = parse(read(cwd));
    expect(raw.prelaunch).toBe(true);
    expect(raw.exclude.noindexExpected).toEqual([]);
  });

  it("some noindex pages become noindexExpected", () => {
    const cwd = build({
      "index.html": page(""),
      "kiitos/index.html": page('<meta name="robots" content="noindex">'),
    });
    run(["init"], cwd);
    const raw = parse(read(cwd));
    expect(raw.prelaunch).toBe(false);
    expect(raw.exclude.noindexExpected).toEqual(["/kiitos/"]);
  });

  it("detected business lands in config", () => {
    const cwd = build({ "index.html": page(BIZ) });
    run(["init"], cwd);
    const raw = parse(read(cwd));
    expect(() => parseConfig(raw)).not.toThrow();
    expect(raw.business).toEqual({
      type: "service-area",
      schemaType: "Electrician",
      name: "Testi Sähkö Oy",
      phone: "+358 40 1234567",
      areaServed: ["Loviisa", "Porvoo"],
      hasReviews: false,
    });
  });

  it("flags override detected values", () => {
    const cwd = build({ "index.html": page(BIZ) });
    run(
      [
        "init",
        "--language",
        "sv",
        "--site",
        "https://x.fi/",
        "--business-type",
        "hybrid",
        "--schema-type",
        "Plumber",
      ],
      cwd,
    );
    const raw = parse(read(cwd));
    expect(raw.language).toBe("sv");
    expect(raw.site).toBe("https://x.fi/");
    expect(raw.business.type).toBe("hybrid");
    expect(raw.business.schemaType).toBe("Plumber");
  });

  it("missing dir still writes config", () => {
    const cwd = tmp();
    const r = run(["init", "build"], cwd);
    expect(r.status).toBe(0);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    const raw = parse(read(cwd));
    expect(raw.input.dir).toBe("build");
    expect(() => parseConfig(raw)).not.toThrow();
  });
});
