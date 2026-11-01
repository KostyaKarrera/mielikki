import { z } from "zod";

export type Severity = "error" | "warning" | "info";
export type LangCode = "fi" | "sv" | "en";

export interface TargetPage {
  url: string;
  primary: string;
  secondary: string[];
  forms: Record<string, string[]>;
}

export interface Config {
  site?: string;
  language?: LangCode;
  region?: string;
  prelaunch: boolean;
  input: {
    dir: string;
    trailingSlash: "always" | "never" | "ignore";
    cleanUrls: boolean;
  };
  business?: {
    type: "brick-and-mortar" | "service-area" | "hybrid";
    schemaType: string;
    name: string;
    phone?: string;
    email?: string;
    areaServed: string[];
    hasReviews: boolean;
  };
  exclude: { noindexExpected: string[]; ignore: string[] };
  placeholders: string[];
  testContacts: { phones: string[]; emails: string[] };
  targets: { required: string[]; pages: TargetPage[] };
  rules: {
    enable: string[];
    disable: string[];
    severity: Record<string, Severity>;
    launchBlocking: Record<string, boolean>;
    options: Record<string, Record<string, unknown>>;
  };
}

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

const BUILTIN_TEST_PHONES = ["^\\+?0+$", "123 ?456 ?7", "^\\+?358 ?0+$"];
const BUILTIN_TEST_EMAILS = ["@example\\.(com|org|net)$", "@test\\.", "^test@"];

const strings = z.array(z.string()).default([]);
const severity = z.enum(["error", "warning", "info"]);

const targetPage = z
  .object({
    url: z.string(),
    primary: z.string(),
    secondary: strings,
    forms: z.record(z.string(), z.array(z.string())).default({}),
  })
  .strict();

const business = z
  .object({
    type: z.enum(["brick-and-mortar", "service-area", "hybrid"]),
    schemaType: z.string(),
    name: z.string(),
    phone: z.string().optional(),
    email: z.string().optional(),
    areaServed: strings,
    hasReviews: z.boolean().default(false),
  })
  .strict();

const site = z
  .string()
  .refine((v) => URL.canParse(v), "must be an absolute URL")
  .transform((v) => v.replace(/\/+$/, ""));

const withBuiltins = (builtins: string[]) =>
  z
    .array(z.string())
    .default([])
    .transform((user) => [
      ...builtins,
      ...user.filter((p) => !builtins.includes(p)),
    ]);

const configSchema = z
  .object({
    site: site.optional(),
    language: z.enum(["fi", "sv", "en"]).optional(),
    region: z.string().optional(),
    prelaunch: z.boolean().default(false),
    input: z
      .object({
        dir: z.string().default("dist"),
        trailingSlash: z.enum(["always", "never", "ignore"]).default("ignore"),
        cleanUrls: z.boolean().default(true),
      })
      .strict()
      .default({ dir: "dist", trailingSlash: "ignore", cleanUrls: true }),
    business: business.optional(),
    exclude: z
      .object({ noindexExpected: strings, ignore: strings })
      .strict()
      .default({ noindexExpected: [], ignore: [] }),
    placeholders: strings,
    testContacts: z
      .object({
        phones: withBuiltins(BUILTIN_TEST_PHONES),
        emails: withBuiltins(BUILTIN_TEST_EMAILS),
      })
      .strict()
      .default({ phones: BUILTIN_TEST_PHONES, emails: BUILTIN_TEST_EMAILS }),
    targets: z
      .object({ required: strings, pages: z.array(targetPage).default([]) })
      .strict()
      .default({ required: [], pages: [] }),
    rules: z
      .object({
        enable: strings,
        disable: strings,
        severity: z.record(z.string(), severity).default({}),
        launchBlocking: z.record(z.string(), z.boolean()).default({}),
        options: z
          .record(z.string(), z.record(z.string(), z.unknown()))
          .default({}),
      })
      .strict()
      .default({
        enable: [],
        disable: [],
        severity: {},
        launchBlocking: {},
        options: {},
      }),
  })
  .strict();

/** Validates raw (already YAML-parsed) config; throws ConfigError with a dotted path. */
export function parseConfig(raw: unknown): Config {
  const result = configSchema.safeParse(raw ?? {});
  if (result.success) return result.data as Config;
  const issue = result.error.issues[0];
  if (!issue) throw new ConfigError("invalid config", "");
  const segments = issue.path.map(String);
  if (issue.code === "unrecognized_keys") segments.push(String(issue.keys[0]));
  const path = segments.join(".");
  const where = path === "" ? "config" : `"${path}"`;
  throw new ConfigError(`Invalid ${where}: ${issue.message}`, path);
}
