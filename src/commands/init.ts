import { access, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { type Config, parseConfig } from "../config/schema.js";
import { loadDir } from "../load/dir.js";
import { isLocalUrl } from "../model/host.js";
import type { Site } from "../model/types.js";
import { nodesOf, typesOf } from "../rules/schema/_helpers.js";
import { detectLanguage, UsageError } from "./check.js";

export const CONFIG_FILE = "mielikki.config.yaml";

type Business = NonNullable<Config["business"]>;

export interface InitOptions {
  site?: string;
  language?: "fi" | "sv" | "en";
  businessType?: Business["type"];
  schemaType?: string;
  force?: boolean;
}

export interface Detected {
  language?: "fi" | "sv" | "en";
  site?: string;
  /** Detected origin that is local/private (never written as `site:`). */
  localSite?: string;
  prelaunch: boolean;
  noindexExpected: string[];
  business?: {
    type: Business["type"];
    schemaType: string;
    name: string;
    phone?: string;
    areaServed: string[];
  };
}

const KNOWN_SUBTYPES = new Set([
  "LocalBusiness",
  "Electrician",
  "Plumber",
  "HVACBusiness",
  "GeneralContractor",
  "RoofingContractor",
  "HousePainter",
  "Locksmith",
  "MovingCompany",
  "HomeAndConstructionBusiness",
  "ProfessionalService",
  "AutoRepair",
  "Store",
  "Restaurant",
  "LegalService",
  "Dentist",
]);
const BUSINESS_SUFFIX = /(Business|Contractor)$/;
const NOT_BUSINESS = new Set([
  "Service",
  "WebService",
  "GovernmentService",
  "FinancialService",
]);

function businessType(node: Record<string, unknown>): string | undefined {
  return typesOf(node).find(
    (t) =>
      t !== "Organization" &&
      !NOT_BUSINESS.has(t) &&
      (KNOWN_SUBTYPES.has(t) || BUSINESS_SUFFIX.test(t)),
  );
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

function areaNames(v: unknown): string[] {
  const items = Array.isArray(v) ? v : v === undefined ? [] : [v];
  const out: string[] = [];
  for (const i of items) {
    const n = isObj(i) ? text(i.name) : text(i);
    if (n !== undefined && !out.includes(n)) out.push(n);
  }
  return out;
}

export function detect(site: Site): Detected {
  const out: Detected = {
    language: detectLanguage(site.pages),
    prelaunch: false,
    noindexExpected: [],
  };
  if (site.site !== undefined) {
    if (isLocalUrl(site.site)) out.localSite = site.site;
    else out.site = site.site;
  }
  const noindexed = site.pages.filter((p) => p.robotsMeta.includes("noindex"));
  if (site.pages.length > 0 && noindexed.length === site.pages.length)
    out.prelaunch = true;
  else out.noindexExpected = noindexed.map((p) => p.key);

  const home = site.byKey.get("/");
  if (home !== undefined) {
    const nodes = nodesOf(home);
    let node = nodes.find((n) => businessType(n) !== undefined);
    let type = node === undefined ? undefined : businessType(node);
    if (node === undefined) {
      node = nodes.find((n) => typesOf(n).includes("Organization"));
      type = "Organization";
    }
    if (node !== undefined && type !== undefined) {
      const address = node.address;
      out.business = {
        type:
          isObj(address) && text(address.streetAddress) !== undefined
            ? "brick-and-mortar"
            : "service-area",
        schemaType: type,
        name: text(node.name) ?? "",
        phone: text(node.telephone),
        areaServed: areaNames(node.areaServed),
      };
    }
  }
  return out;
}

const q = (s: string): string => JSON.stringify(s);
const list = (items: string[]): string => `[${items.map(q).join(", ")}]`;

export function renderConfig(
  inputDir: string,
  d: Detected,
  o: InitOptions,
): string {
  const language = o.language ?? d.language;
  const siteUrl = o.site ?? d.site;
  const lines: string[] = [
    "# Mielikki configuration. Docs: `mielikki rules` lists all rules.",
    "",
    "# Canonical origin of the production site (absolute URL).",
    ...(siteUrl
      ? [`site: ${q(siteUrl)}`]
      : [
          ...(d.localSite
            ? [
                `# Detected ${d.localSite} is a local address; set the production URL.`,
              ]
            : []),
          '# site: "https://example.fi"',
        ]),
    "",
    "# Content language: fi, sv or en.",
    language ? `language: ${language}` : "# language: fi",
    "",
    "# Set to true before the site goes live: noindex and robots blocks are then",
    "# expected and not reported as indexing problems.",
    `prelaunch: ${d.prelaunch}`,
    "",
    "# The build folder to audit and how its URLs are shaped.",
    "input:",
    `  dir: ${q(inputDir)}`,
    "  trailingSlash: ignore # always | never | ignore",
    "",
  ];
  const b = d.business;
  if (o.businessType !== undefined || o.schemaType !== undefined || b) {
    lines.push(
      "# The business behind the site; used by the schema and local rules.",
      "business:",
      `  type: ${o.businessType ?? b?.type ?? "service-area"} # brick-and-mortar | service-area | hybrid`,
      `  schemaType: ${q(o.schemaType ?? b?.schemaType ?? "LocalBusiness")} # most specific schema.org type, e.g. Electrician`,
      `  name: ${q(b?.name ?? "")}`,
    );
    if (b?.phone) lines.push(`  phone: ${q(b.phone)}`);
    lines.push(
      `  areaServed: ${list(b?.areaServed ?? [])}`,
      "  hasReviews: false # rating markup without real reviews is an error",
      "",
    );
  }
  lines.push(
    "# Pages that are intentionally noindex (glob patterns allowed).",
    "# ignore: pages skipped entirely.",
    "exclude:",
    `  noindexExpected: ${list(d.noindexExpected)}`,
    "  ignore: []",
    "",
    "# Extra placeholder texts to flag (built-in markers are always checked).",
    "placeholders: []",
    "",
    "# Extra test phone/email regexes (built-in patterns are always applied).",
    "testContacts:",
    "  phones: []",
    "  emails: []",
    "",
    "# Target pages. required: URL patterns of pages that must have a target query",
    "# (targets/missing-target) and use the higher word-count threshold.",
    "# pages: search-query targets, e.g.",
    "#   - url: /palvelut/",
    "#     primary: main query",
    "#     secondary: [other query]",
    "targets:",
    "  required: ['/']",
    "  pages: []",
    "",
    "# Rule overrides.",
    "# severity: { content/word-count: info }, launchBlocking: { rule-id: false }",
    "rules:",
    "  enable: []",
    "  disable: []",
    "  severity: {}",
    "  launchBlocking: {}",
    "  options: {}",
    "",
  );
  return lines.join("\n");
}

export async function runInit(
  dirArg: string | undefined,
  opts: InitOptions,
  io: { cwd: string; write(s: string): void; warn(s: string): void },
): Promise<number> {
  const dirName = dirArg ?? "dist";
  const target = path.join(io.cwd, CONFIG_FILE);
  if (
    !opts.force &&
    (await access(target).then(
      () => true,
      () => false,
    ))
  )
    throw new UsageError(
      `${CONFIG_FILE} already exists (use --force to overwrite)`,
    );

  const dir = path.resolve(io.cwd, dirName);
  let detected: Detected = { prelaunch: false, noindexExpected: [] };
  const found = await readdir(dir).then(
    () => true,
    () => false,
  );
  if (found) detected = detect(await loadDir(dir, parseConfig({})));
  else
    io.warn(`mielikki: directory not found: ${dirName} (nothing autodetected)`);

  const content = renderConfig(dirName, detected, opts);
  parseConfig(parse(content)); // never write an invalid config
  try {
    await writeFile(target, content, { flag: opts.force ? "w" : "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST")
      throw new UsageError(
        `${CONFIG_FILE} already exists (use --force to overwrite)`,
      );
    throw err;
  }
  io.write(`wrote ${CONFIG_FILE}\n`);
  return 0;
}
