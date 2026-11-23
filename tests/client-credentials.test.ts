/**
 * client-credentials.test.ts — #728 (ADR-0040 D3-1/D3-4/D3-5): the adapter's credential file. One file per AI app
 * name, next to host.json, 0600; the client id is created EXCLUSIVELY so two adapters started at once (Claude
 * Desktop starts its MCP server twice) settle on ONE client id — asked here with real, concurrent processes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { buildSync } from "esbuild";
import { CredentialFile, credentialPath } from "../src/mcp/client-credentials";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "slidecraft-cred-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("credentialPath — next to host.json, one per AI app name", () => {
  it("same folder as host.json; distinct names → distinct files; same name → same file", () => {
    const hj = join(dir, "host.json");
    const a = credentialPath(hj, "Claude Desktop");
    expect(dirname(a)).toBe(dir);
    expect(credentialPath(hj, "Claude Desktop")).toBe(a);
    expect(credentialPath(hj, "Cursor")).not.toBe(a);
  });
  it("a name with path characters cannot escape the folder", () => {
    const p = credentialPath(join(dir, "host.json"), "../../etc/passwd");
    expect(dirname(p)).toBe(dir);
  });
});

describe("CredentialFile", () => {
  it("creates a client id once (0600 on POSIX) and returns the same one afterwards", () => {
    const f = new CredentialFile(join(dir, "c1.json"));
    const a = f.ensure();
    expect(a.clientId).toMatch(/^[A-Za-z0-9_-]{8,128}$/); // what the host accepts (host.ts CLIENT_ID)
    expect(new CredentialFile(join(dir, "c1.json")).ensure().clientId).toBe(a.clientId);
    if (process.platform !== "win32") expect(statSync(join(dir, "c1.json")).mode & 0o777).toBe(0o600);
  });

  it("saveSecret keeps the client id and records the version the secret was granted for; clearSecret drops only the secret", () => {
    const f = new CredentialFile(join(dir, "c2.json"));
    const { clientId } = f.ensure();
    f.saveSecret("1.2.3", "s3cret");
    expect(f.ensure()).toEqual({ clientId, version: "1.2.3", secret: "s3cret" });
    if (process.platform !== "win32") expect(statSync(join(dir, "c2.json")).mode & 0o777).toBe(0o600);
    f.clearSecret();
    expect(f.ensure()).toEqual({ clientId });
  });

  it("a corrupt file is replaced by a fresh client id (never a crash)", () => {
    const p = join(dir, "c3.json");
    writeFileSync(p, "{not json");
    const c = new CredentialFile(p).ensure();
    expect(c.clientId).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(JSON.parse(readFileSync(p, "utf8")).clientId).toBe(c.clientId);
  });

  it("no temp files are left behind", () => {
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("two processes creating the file at the same time settle on ONE client id", () => {
  it("8 concurrent processes → one client id", async () => {
    const bundle = join(dir, "cred-entry.cjs");
    const entry = join(dir, "cred-entry.ts");
    writeFileSync(
      entry,
      `import { CredentialFile } from ${JSON.stringify(resolve(__dirname, "../src/mcp/client-credentials"))};\n` +
        `const go = Number(process.argv[3]); while (Date.now() < go) {} // start together\n` +
        `process.stdout.write(new CredentialFile(process.argv[2]).ensure().clientId);\n`,
    );
    buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", outfile: bundle, logLevel: "silent" });
    for (let round = 0; round < 3; round++) {
      const target = join(dir, `race-${round}.json`);
      const go = String(Date.now() + 400);
      const ids = await Promise.all(
        Array.from({ length: 8 }, () =>
          new Promise<string>((res, rej) => {
            const child = spawn(process.execPath, [bundle, target, go], { stdio: ["ignore", "pipe", "pipe"] });
            let out = "";
            let err = "";
            child.stdout.on("data", (d) => (out += d));
            child.stderr.on("data", (d) => (err += d));
            child.on("exit", (code) => (code === 0 ? res(out) : rej(new Error(err))));
          }),
        ),
      );
      expect(new Set(ids).size).toBe(1);
      expect(JSON.parse(readFileSync(target, "utf8")).clientId).toBe(ids[0]);
    }
  }, 30_000);
});
