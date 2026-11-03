import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tokenPath } from "../../src/gsc/paths.js";
import {
  clearToken,
  loadToken,
  type StoredToken,
  saveToken,
} from "../../src/gsc/token-store.js";

let tmp: string;
afterEach(() => rmSync(tmp, { recursive: true, force: true }));
const mk = (): string => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "mielikki-tok-"));
  return tmp;
};
const tok: StoredToken = {
  clientId: "id",
  clientSecret: "secret-value",
  refreshToken: "refresh-value",
  source: "oauth-client",
};

describe("token store", () => {
  it("tightens a pre-existing 0755 dir to 0700", async () => {
    const d = path.join(mk(), "m");
    await mkdir(d, { mode: 0o755 });
    await chmod(d, 0o755);
    await saveToken(path.join(d, "t.json"), tok);
    expect(statSync(d).mode & 0o777).toBe(0o700);
  });
  it("refuses a symlinked config dir", async () => {
    const base = mk();
    await mkdir(path.join(base, "real"));
    await symlink(path.join(base, "real"), path.join(base, "link"));
    await expect(
      saveToken(path.join(base, "link", "t.json"), tok),
    ).rejects.toThrow(/symlink/);
    expect(readdirSync(path.join(base, "real"))).toEqual([]);
  });
  it("writes dir 0700 and file 0600 and round-trips", async () => {
    const f = path.join(mk(), "cfg", "mielikki", "gsc-token.json");
    await saveToken(f, tok);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(f)).mode & 0o777).toBe(0o700);
    expect(await loadToken(f)).toEqual(tok);
    expect(readdirSync(path.dirname(f))).toEqual(["gsc-token.json"]);
  });
  it("overwrites an existing file keeping 0600", async () => {
    const f = path.join(mk(), "m", "t.json");
    await saveToken(f, tok);
    await saveToken(f, { ...tok, refreshToken: "other-refresh" });
    expect((await loadToken(f))?.refreshToken).toBe("other-refresh");
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });
  it("corrupt or malformed file gives undefined", async () => {
    const d = mk();
    await mkdir(d, { recursive: true });
    const f = path.join(d, "t.json");
    await writeFile(f, "{not json");
    expect(await loadToken(f)).toBeUndefined();
    await writeFile(f, JSON.stringify({ clientId: 1 }));
    expect(await loadToken(f)).toBeUndefined();
    expect(await loadToken(path.join(d, "missing.json"))).toBeUndefined();
  });
  it("clearToken removes the file and tolerates absence", async () => {
    const f = path.join(mk(), "m", "t.json");
    await saveToken(f, tok);
    await clearToken(f);
    expect(existsSync(f)).toBe(false);
    await clearToken(f);
  });
  it("tokenPath honours XDG_CONFIG_HOME", () => {
    expect(tokenPath({ XDG_CONFIG_HOME: "/x/cfg" }, "/home/u")).toBe(
      "/x/cfg/mielikki/gsc-token.json",
    );
    expect(tokenPath({}, "/home/u")).toBe(
      "/home/u/.config/mielikki/gsc-token.json",
    );
  });
});
