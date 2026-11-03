import { mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDiskCache, nullCache } from "../../src/research/cache.js";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mielikki-cache-"));
}

describe("createDiskCache", () => {
  it("returns a stored value", async () => {
    const cache = createDiskCache(await tmp(), 1000);
    await cache.set("k", "v");
    expect(await cache.get("k")).toBe("v");
  });
  it("misses on unknown key", async () => {
    const cache = createDiskCache(await tmp(), 1000);
    expect(await cache.get("none")).toBeUndefined();
  });
  it("expires entries older than the TTL", async () => {
    let t = 1000;
    const cache = createDiskCache(await tmp(), 500, () => t);
    await cache.set("k", "v");
    t = 1499;
    expect(await cache.get("k")).toBe("v");
    t = 1501;
    expect(await cache.get("k")).toBeUndefined();
  });
  it("treats corrupt files as a miss", async () => {
    const dir = await tmp();
    const cache = createDiskCache(dir, 1000);
    await cache.set("k", "v");
    const [file] = await readdir(dir);
    await writeFile(join(dir, file as string), "{not json");
    expect(await cache.get("k")).toBeUndefined();
    await writeFile(join(dir, file as string), '{"at":"x","value":1}');
    expect(await cache.get("k")).toBeUndefined();
  });
  it("hashes the key into the file name", async () => {
    const dir = await tmp();
    const cache = createDiskCache(dir, 1000);
    await cache.set("https://x/a/b?q=1", "v");
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain("/");
    expect(files[0]).not.toContain("x/a/b");
    expect(files[0]).toMatch(/^[0-9a-f]{64}/);
  });
  it("writes files 0600 and directory 0700", async () => {
    const dir = join(await tmp(), "c");
    const cache = createDiskCache(dir, 1000);
    await cache.set("k", "v");
    const [file] = await readdir(dir);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, file as string))).mode & 0o777).toBe(0o600);
  });
  it("creates the cache directory on set", async () => {
    const dir = join(await tmp(), "a", "b");
    const cache = createDiskCache(dir, 1000);
    await cache.set("k", "v");
    expect(await cache.get("k")).toBe("v");
  });
});

describe("nullCache", () => {
  it("never hits", async () => {
    await nullCache.set("k", "v");
    expect(await nullCache.get("k")).toBeUndefined();
  });
});
