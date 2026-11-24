/**
 * client-credentials.ts — #728 (ADR-0040 D3-1/D3-4/D3-5): the stdio adapter's ONE credential file per AI app name,
 * next to host.json, 0600 (as host-json.ts; on Windows the per-user profile's default ACL, as there). It holds
 * the adapter's client id (created once — the pair's identity, so the human allows an app ONCE) and, after
 * [許可], the per-pair secret with the clientInfo version it was granted for. The secret is never sent: the
 * adapter proves it with an HMAC over a host nonce (host-attach.ts).
 *
 * This is the second narrow exception to --no-fs (the first: reading host.json): the adapter reads and writes
 * ONLY its own credential file, never deck content. All reads/writes live in this module.
 *
 * EXCLUSIVE CREATION: Claude Desktop starts its MCP server twice, so two adapters can create the file at the same
 * moment. The first one written is complete before it is visible: write a private temp file, then hard-link it
 * into place (link fails with EEXIST if the other process won — then read theirs). Updates replace the file
 * atomically (rename), so a reader never sees half a file.
 */
import { createHash, randomBytes } from "crypto";
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export interface ClientCredential {
  /** the adapter's client id — host.ts accepts /^[A-Za-z0-9_-]{8,128}$/ */
  clientId: string;
  /** the clientInfo version the secret was granted for (the host keys the pair on name + version + client id) */
  version?: string;
  /** the per-pair secret from /auth/claim (absent until the human allowed this pair) */
  secret?: string;
}

const CLIENT_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** `<folder of host.json>/mcp-client-<slug>-<hash>.json`. The slug keeps it readable; the hash keeps distinct
 *  names apart; neither can carry a path separator. */
export function credentialPath(hostJsonPath: string, appName: string): string {
  const slug = appName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "unknown";
  const hash = createHash("sha256").update(appName).digest("hex").slice(0, 8);
  return join(dirname(hostJsonPath), `mcp-client-${slug}-${hash}.json`);
}

function parse(text: string): ClientCredential | null {
  try {
    const v = JSON.parse(text) as Partial<ClientCredential>;
    if (typeof v.clientId !== "string" || !CLIENT_ID.test(v.clientId)) return null;
    const out: ClientCredential = { clientId: v.clientId };
    if (typeof v.secret === "string" && v.secret && typeof v.version === "string") {
      out.version = v.version;
      out.secret = v.secret;
    }
    return out;
  } catch {
    return null;
  }
}

const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export class CredentialFile {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** The credential, creating the client id on first use (exclusively — concurrent creators agree on one). */
  ensure(): ClientCredential {
    const existing = this.read();
    if (existing) return existing;
    const fresh: ClientCredential = { clientId: randomBytes(18).toString("base64url") };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = this.writeTemp(fresh);
    try {
      linkSync(tmp, this.path); // atomic + exclusive: complete content, or EEXIST
      return fresh;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        // Someone else won the race (their file is complete — link only exposes finished files) or the file is
        // corrupt (read() returned null above). Take theirs if it parses; replace a corrupt one.
        const theirs = this.readWithRetry();
        if (theirs) return theirs;
        renameSync(tmp, this.path);
        return fresh;
      }
      // A file system without hard links: exclusive create, then write (readers retry briefly — readWithRetry).
      try {
        writeFileSync(this.path, JSON.stringify(fresh), { mode: 0o600, flag: "wx" });
        return fresh;
      } catch {
        const theirs = this.readWithRetry();
        if (theirs) return theirs;
        throw e;
      }
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  /** Keep the secret the host issued for this pair (after [許可]). The client id is unchanged. */
  saveSecret(version: string, secret: string): void {
    this.replace({ clientId: this.ensure().clientId, version, secret });
  }

  /** The grant was revoked (D3-5): drop the secret, keep the client id — both adapters of the same app keep
   *  applying as ONE pair, so the human sees one dialog. */
  clearSecret(): void {
    const cur = this.read();
    if (cur?.secret) this.replace({ clientId: cur.clientId });
  }

  private read(): ClientCredential | null {
    try {
      return parse(readFileSync(this.path, "utf8"));
    } catch {
      return null;
    }
  }

  private readWithRetry(): ClientCredential | null {
    for (let i = 0; i < 20; i++) {
      const v = this.read();
      if (v) return v;
      sleepSync(10);
    }
    return null;
  }

  private writeTemp(c: ClientCredential): string {
    const tmp = `${this.path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(c), { mode: 0o600, flag: "wx" });
    if (process.platform !== "win32") {
      try {
        chmodSync(tmp, 0o600); // umask-proof, as host-json.ts
      } catch {
        /* best effort */
      }
    }
    return tmp;
  }

  private replace(c: ClientCredential): void {
    const tmp = this.writeTemp(c);
    try {
      renameSync(tmp, this.path);
    } finally {
      rmSync(tmp, { force: true });
    }
  }
}
