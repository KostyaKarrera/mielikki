import { describe, expect, it } from "vitest";
import { csvCell, renderData } from "../../src/research/output.js";
import type { DataFile } from "../../src/research/types.js";

interface Row {
  query: string;
  count: number;
}

const file: DataFile<Row> = {
  kind: "suggest",
  rows: [
    { count: 2, query: "sähkö|asentaja" },
    { count: 1, query: "=cmd" },
  ],
  errors: [{ source: "suggest", target: "a", message: "boom" }],
};

describe("csvCell", () => {
  it("neutralises formula injection", () => {
    expect(csvCell("=cmd")).toBe("'=cmd");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@x")).toBe("'@x");
  });
  it("quotes and doubles quotes", () => {
    expect(csvCell('a,"b"\n')).toBe('"a,""b""\n"');
  });
  it("keeps unicode and numbers", () => {
    expect(csvCell("sähkö")).toBe("sähkö");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(null)).toBe("");
  });
  it("quotes after injection prefix when needed", () => {
    expect(csvCell("=a,b")).toBe('"\'=a,b"');
  });
});

describe("renderData", () => {
  it("json has stable key order and a single trailing newline", () => {
    const out = renderData(file, "json", ["query", "count"]);
    expect(out.endsWith("}\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["kind", "rows", "errors"]);
    expect(Object.keys((parsed.rows as object[])[0] as object)).toEqual([
      "query",
      "count",
    ]);
  });
  it("includes meta only when present", () => {
    const withMeta: DataFile<Row> = {
      ...file,
      meta: { generatedAt: "t", version: "1", params: { a: 1 } },
    };
    const parsed = JSON.parse(renderData(withMeta, "json", ["query"])) as {
      meta?: unknown;
    };
    expect(parsed.meta).toBeDefined();
    expect(renderData(file, "json", ["query"])).not.toContain('"meta"');
  });
  it("csv has a header, CRLF-free rows and injection protection", () => {
    const out = renderData(file, "csv", ["query", "count"]);
    expect(out).toBe("query,count\nsähkö|asentaja,2\n'=cmd,1\n");
  });
  it("md escapes pipes", () => {
    const out = renderData(file, "md", ["query", "count"]);
    expect(out).toBe(
      "| query | count |\n| --- | --- |\n| sähkö\\|asentaja | 2 |\n| =cmd | 1 |\n",
    );
  });
});
