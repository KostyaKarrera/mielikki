import { describe, expect, it } from "vitest";
import { MAX_NESTING, maxOpenDepth } from "../../src/parse/depth.js";
import { PageTooDeepError, parsePage } from "../../src/parse/page.js";

describe("maxOpenDepth", () => {
  it("counts nested elements", () => {
    expect(
      maxOpenDepth("<html><body><div><span>x</span></div></body></html>"),
    ).toBe(4);
    expect(maxOpenDepth("")).toBe(0);
    expect(maxOpenDepth("plain text")).toBe(0);
  });
  it("ignores void elements and optional end tags", () => {
    expect(maxOpenDepth("<div><br><img src=a><hr><input><meta></div>")).toBe(1);
    expect(maxOpenDepth("<ul>" + "<li>x".repeat(5000) + "</ul>")).toBe(1);
    expect(
      maxOpenDepth("<table>" + "<tr><td>x".repeat(5000) + "</table>"),
    ).toBe(1);
    expect(maxOpenDepth("<p>a<p>b<p>c")).toBe(0);
  });
  it("skips comments and doctype", () => {
    expect(
      maxOpenDepth("<!doctype html><!-- <div><div><div> --><b>x</b>"),
    ).toBe(1);
    expect(maxOpenDepth("<!-- unterminated <div><div>")).toBe(0);
  });
  it("does not count tags inside script/style/textarea", () => {
    expect(
      maxOpenDepth(
        "<div><script>var a='<div><div><div>';</script><style>div>div{}</style></div>",
      ),
    ).toBe(1);
    expect(maxOpenDepth("<script>" + "<div>".repeat(100))).toBe(0);
    expect(maxOpenDepth("<SCRIPT>x</SCRIPT><div>")).toBe(1);
  });
  it("handles '>' inside quoted attribute values", () => {
    expect(
      maxOpenDepth("<div title=\"a>b\"><span data-x='<div>'>x</span></div>"),
    ).toBe(2);
    expect(maxOpenDepth('<a href="x>y"><b></b></a>')).toBe(2);
  });
  it("tolerates unbalanced closers", () => {
    expect(maxOpenDepth("</div></div></span><div>")).toBe(1);
    expect(maxOpenDepth("<div></div></div></div><div><div>")).toBe(2);
  });
  it("self-closing counts only in svg/math", () => {
    expect(maxOpenDepth("<svg>" + "<path/>".repeat(3000) + "</svg>")).toBe(1);
    expect(maxOpenDepth("<div/>".repeat(10))).toBe(10);
  });
  it("is case-insensitive and ignores stray '<'", () => {
    expect(maxOpenDepth("a < b <DIV><Br></DIV> 1<2")).toBe(1);
  });
});

describe("parsePage depth guard", () => {
  it("refuses 100k nested divs quickly", () => {
    const html = `<html><body>${"<div>".repeat(100_000)}</body></html>`;
    const t = performance.now();
    let err: unknown;
    try {
      parsePage(html, "/");
    } catch (e) {
      err = e;
    }
    expect(performance.now() - t).toBeLessThan(500);
    expect(err).toBeInstanceOf(PageTooDeepError);
    expect((err as PageTooDeepError).message).toBe(
      `page too deeply nested (100002 > ${MAX_NESTING})`,
    );
  });
  it("parses at the cap", () => {
    const html = `<html><body>${"<div>".repeat(MAX_NESTING - 2)}x</body></html>`;
    expect(() => parsePage(html, "/")).not.toThrow();
  });
});
