import type { DataFile } from "./types.js";

export function csvCell(v: unknown): string {
  if (v === undefined || v === null) return "";
  let s = typeof v === "string" ? v : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function mdCell(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return s.replace(/\r\n|\r|\n/g, " ").replace(/[\\`|<>[\]]/g, (c) => `\\${c}`);
}

export function renderData<T extends object>(
  file: DataFile<T>,
  format: "json" | "csv" | "md",
  columns: (keyof T & string)[],
): string {
  const cell = (row: T, c: keyof T & string): unknown =>
    (row as Record<string, unknown>)[c];
  if (format === "json") {
    const out: Record<string, unknown> = { kind: file.kind };
    if (file.meta) {
      out.meta = {
        generatedAt: file.meta.generatedAt,
        version: file.meta.version,
        params: Object.fromEntries(
          Object.entries(file.meta.params).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        ),
      };
    }
    out.rows = file.rows.map((r) =>
      Object.fromEntries(columns.map((c) => [c, cell(r, c) ?? null])),
    );
    out.errors = file.errors.map((e) => ({
      source: e.source,
      target: e.target,
      message: e.message,
    }));
    return `${JSON.stringify(out, null, 2)}\n`;
  }
  if (format === "csv") {
    const lines = [columns.map((c) => csvCell(c)).join(",")];
    for (const r of file.rows) {
      lines.push(columns.map((c) => csvCell(cell(r, c))).join(","));
    }
    return `${lines.join("\n")}\n`;
  }
  const lines = [
    `| ${columns.map(mdCell).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
  ];
  for (const r of file.rows) {
    lines.push(`| ${columns.map((c) => mdCell(cell(r, c))).join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}
