import { describe, expect, it } from "vitest";
import { isLocalHost, isLocalUrl } from "../../src/model/host.js";

describe("isLocalHost", () => {
  it.each([
    "localhost",
    "LOCALHOST:4321",
    "127.0.0.1",
    "127.1.2.3:80",
    "[::1]",
    "[::1]:4321",
    "dev.localhost",
    "printer.local",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.10.10",
    "0.0.0.0",
  ])("%s is local", (h) => expect(isLocalHost(h)).toBe(true));
  it.each([
    "example.fi",
    "sahko.example",
    "172.15.0.1",
    "172.32.0.1",
    "192.169.0.1",
    "8.8.8.8",
    "localhost.example.fi",
    "local.fi",
  ])("%s is public", (h) => expect(isLocalHost(h)).toBe(false));
});

describe("isLocalUrl", () => {
  it("checks http(s) URLs only", () => {
    expect(isLocalUrl("http://localhost:4321/")).toBe(true);
    expect(isLocalUrl("https://[::1]/a/")).toBe(true);
    expect(isLocalUrl("https://example.fi/")).toBe(false);
    expect(isLocalUrl("/relative/")).toBe(false);
    expect(isLocalUrl("ftp://localhost/")).toBe(false);
  });
});
