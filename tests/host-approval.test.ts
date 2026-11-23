/**
 * host-approval.test.ts — #727 (ADR-0040 D3): the pure approval book behind the always-on collab host.
 * A client that holds the shared token may only APPLY; tool calls need the human's [許可] in the GUI.
 * The key is ("clientInfo" name+version, client ID). stdio adapters prove a stored grant with an HMAC over
 * a host-issued nonce (the secret never travels after the one-time claim); HTTP-direct clients are
 * approved per `mcp-session-id`. Default deny, ≤3 pending, [この起動中はすべて拒否], revoke.
 */
import { describe, it, expect } from "vitest";
import { ApprovalBook, proofFor, type StoredGrant } from "../src/mcp/host-approval";

const CD = { name: "Claude Desktop", version: "1.0.0" };
const CLIENT_ID = "cid-0123456789abcdef";

/** An adapter applying with a fresh one-time claim (no stored secret yet). */
const applyAdapter = (book: ApprovalBook, conn: string, clientId = CLIENT_ID, info = CD, claim = `claim-${conn}`) =>
  book.apply(conn, info, { kind: "adapter", clientId, claim });

describe("ApprovalBook: the decision states (D3-3)", () => {
  it("an unknown pair is pending; allow → approved", () => {
    const book = new ApprovalBook();
    expect(applyAdapter(book, "c1")).toBe("pending");
    expect(book.status("c1")).toBe("pending");
    const [req] = book.view().pending;
    expect(req).toMatchObject({ name: "Claude Desktop", version: "1.0.0", fingerprint: CLIENT_ID.slice(0, 8), kind: "adapter" });
    book.decide(req.requestId, "allow");
    expect(book.status("c1")).toBe("approved");
  });

  it("deny → denied, and the same pair is denied again for the rest of the launch without a new dialog", () => {
    const book = new ApprovalBook();
    applyAdapter(book, "c1");
    book.decide(book.view().pending[0].requestId, "deny");
    expect(book.status("c1")).toBe("denied");
    expect(applyAdapter(book, "c2")).toBe("denied");
    expect(book.view().pending).toHaveLength(0);
  });

  it("revoke → revoked for the connections approved by that grant", () => {
    const book = new ApprovalBook();
    applyAdapter(book, "c1");
    book.decide(book.view().pending[0].requestId, "allow");
    const [g] = book.view().grants;
    expect(book.revoke(g.key)).toBe(true);
    expect(book.status("c1")).toBe("revoked");
    expect(book.view().grants).toHaveLength(0);
  });

  it("an unknown connection has no status (the host treats it as never applied)", () => {
    expect(new ApprovalBook().status("nope")).toBeUndefined();
  });
});

describe("ApprovalBook: one dialog per pair, ≤3 pending, deny-all (D3-2)", () => {
  it("simultaneous applications by the SAME pair share one request (Claude Desktop starts 2 servers)", () => {
    const book = new ApprovalBook();
    applyAdapter(book, "c1");
    applyAdapter(book, "c2");
    expect(book.view().pending).toHaveLength(1);
    book.decide(book.view().pending[0].requestId, "allow");
    expect([book.status("c1"), book.status("c2")]).toEqual(["approved", "approved"]);
  });

  it("with 3 requests pending, a 4th pair is denied automatically (no dialog)", () => {
    const book = new ApprovalBook();
    for (const i of [1, 2, 3]) expect(applyAdapter(book, `c${i}`, `cid-${i}-aaaaaaaa`)).toBe("pending");
    expect(applyAdapter(book, "c4", "cid-4-aaaaaaaa")).toBe("denied");
    expect(book.view().pending).toHaveLength(3);
  });

  it("deny-all denies the request, every other pending request, and every later application", () => {
    const book = new ApprovalBook();
    applyAdapter(book, "c1", "cid-1-aaaaaaaa");
    applyAdapter(book, "c2", "cid-2-aaaaaaaa");
    book.decide(book.view().pending[0].requestId, "deny-all");
    expect([book.status("c1"), book.status("c2")]).toEqual(["denied", "denied"]);
    expect(book.view()).toMatchObject({ pending: [], denyAll: true });
    expect(applyAdapter(book, "c3", "cid-3-aaaaaaaa")).toBe("denied");
    expect(book.apply("c4", CD, { kind: "session", sessionId: "sid-4" })).toBe("denied");
  });

  it("an unknown request id is a no-op (never throws, never approves)", () => {
    const book = new ApprovalBook();
    applyAdapter(book, "c1");
    expect(book.decide("no-such-request", "allow")).toEqual({});
    expect(book.status("c1")).toBe("pending");
  });
});

describe("ApprovalBook: adapter secret, claim and nonce HMAC (D3-4)", () => {
  const allowAndClaim = (book: ApprovalBook): { grant: StoredGrant; secret: string } => {
    applyAdapter(book, "c1");
    const { grant } = book.decide(book.view().pending[0].requestId, "allow");
    const secret = book.redeemClaim(CLIENT_ID, "claim-c1");
    return { grant: grant!, secret: secret! };
  };

  it("allow returns the grant to persist (pair + secret); only the applicant's claim redeems it, once", () => {
    const book = new ApprovalBook();
    const { grant, secret } = allowAndClaim(book);
    expect(grant).toMatchObject({ name: CD.name, version: CD.version, clientId: CLIENT_ID });
    expect(secret).toBe(grant.secret);
    expect(Buffer.from(secret, "base64url").length).toBe(32);
    expect(book.redeemClaim(CLIENT_ID, "claim-c1")).toBeUndefined(); // one-time
    expect(book.redeemClaim(CLIENT_ID, "someone-elses-claim")).toBeUndefined();
  });

  it("a claim does not redeem before the human allows", () => {
    const book = new ApprovalBook();
    applyAdapter(book, "c1");
    expect(book.redeemClaim(CLIENT_ID, "claim-c1")).toBeUndefined();
  });

  it("a correct HMAC over a fresh nonce is approved at once (no dialog); the nonce is single-use", () => {
    const book = new ApprovalBook();
    const { secret } = allowAndClaim(book);
    const nonce = book.issueNonce();
    const proof = proofFor(secret, nonce, CLIENT_ID, CD);
    expect(book.apply("c2", CD, { kind: "adapter", clientId: CLIENT_ID, claim: "x", nonce, proof })).toBe("approved");
    expect(book.apply("c3", CD, { kind: "adapter", clientId: CLIENT_ID, claim: "y", nonce, proof })).toBe("pending"); // replayed nonce
  });

  it("a wrong HMAC (wrong secret / other pair / unknown nonce) does not pass — it falls back to a dialog", () => {
    const book = new ApprovalBook();
    const { secret } = allowAndClaim(book);
    const n1 = book.issueNonce();
    expect(book.apply("c2", CD, { kind: "adapter", clientId: CLIENT_ID, claim: "a", nonce: n1, proof: proofFor("wrong-secret", n1, CLIENT_ID, CD) })).toBe("pending");
    const n2 = book.issueNonce();
    const other = { name: "Evil", version: "1" };
    expect(book.apply("c3", other, { kind: "adapter", clientId: CLIENT_ID, claim: "b", nonce: n2, proof: proofFor(secret, n2, CLIENT_ID, other) })).toBe("pending");
    expect(book.apply("c4", CD, { kind: "adapter", clientId: CLIENT_ID, claim: "c", nonce: "never-issued", proof: proofFor(secret, "never-issued", CLIENT_ID, CD) })).toBe("pending");
  });

  it("an expired nonce does not pass", () => {
    let t = 1_000;
    const book = new ApprovalBook({ now: () => t, nonceTtlMs: 100 });
    const { secret } = allowAndClaim(book);
    const nonce = book.issueNonce();
    t += 101;
    expect(book.apply("c2", CD, { kind: "adapter", clientId: CLIENT_ID, claim: "x", nonce, proof: proofFor(secret, nonce, CLIENT_ID, CD) })).toBe("pending");
  });

  it("grants loaded from the keychain approve a valid proof; a proof that arrived BEFORE the load is re-checked", () => {
    const stored: StoredGrant = { name: CD.name, version: CD.version, clientId: CLIENT_ID, secret: "stored-secret" };
    const book = new ApprovalBook();
    const early = book.issueNonce();
    expect(book.apply("c1", CD, { kind: "adapter", clientId: CLIENT_ID, claim: "a", nonce: early, proof: proofFor(stored.secret, early, CLIENT_ID, CD) })).toBe("pending");
    book.loadGrants([stored]);
    expect(book.status("c1")).toBe("approved");
    expect(book.view().pending).toHaveLength(0);
    const n = book.issueNonce();
    expect(book.apply("c2", CD, { kind: "adapter", clientId: CLIENT_ID, claim: "b", nonce: n, proof: proofFor(stored.secret, n, CLIENT_ID, CD) })).toBe("approved");
  });

  it("re-loading the same grants keeps each grant's key, so [取り消し] still reaches connections approved earlier", () => {
    const book = new ApprovalBook();
    const { grant } = allowAndClaim(book);
    const key = book.view().grants[0].key;
    book.loadGrants([grant]); // the GUI hands its keychain copy back (e.g. after saving the new grant)
    expect(book.view().grants.map((g) => g.key)).toEqual([key]);
    book.revoke(key);
    expect(book.status("c1")).toBe("revoked");
  });

  it("a grant missing from the loaded list is revoked (the keychain is the GUI's truth)", () => {
    const book = new ApprovalBook();
    allowAndClaim(book);
    book.loadGrants([]);
    expect(book.status("c1")).toBe("revoked");
    expect(book.view().grants).toHaveLength(0);
  });

  it("an adapter grant's view names its client id (so the GUI can drop exactly that pair from the keychain on revoke)", () => {
    const book = new ApprovalBook();
    allowAndClaim(book);
    expect(book.view().grants[0]).toMatchObject({ kind: "adapter", clientId: CLIENT_ID });
  });

  it("the grant list the GUI sees never carries a secret", () => {
    const book = new ApprovalBook();
    const { secret } = allowAndClaim(book);
    expect(JSON.stringify(book.view())).not.toContain(secret);
  });
});

describe("ApprovalBook: HTTP-direct approval is bound to the mcp-session-id (D3-7)", () => {
  it("each session is its own pair; allowing one session does not approve another", () => {
    const book = new ApprovalBook();
    expect(book.apply("s1", CD, { kind: "session", sessionId: "sid-aaaaaaaa-1" })).toBe("pending");
    expect(book.apply("s2", CD, { kind: "session", sessionId: "sid-bbbbbbbb-2" })).toBe("pending");
    const pend = book.view().pending;
    expect(pend.map((p) => p.fingerprint).sort()).toEqual(["sid-aaaa", "sid-bbbb"]);
    book.decide(pend.find((p) => p.fingerprint === "sid-aaaa")!.requestId, "allow");
    expect([book.status("s1"), book.status("s2")]).toEqual(["approved", "pending"]);
  });

  it("a session approval issues no persistent grant and ends with the connection", () => {
    const book = new ApprovalBook();
    book.apply("s1", CD, { kind: "session", sessionId: "sid-1" });
    expect(book.decide(book.view().pending[0].requestId, "allow")).toEqual({});
    expect(book.view().grants).toMatchObject([{ kind: "session" }]);
    book.forget("s1");
    expect(book.view().grants).toHaveLength(0);
    expect(book.status("s1")).toBeUndefined();
  });

  it("forgetting the last waiting connection withdraws its request (no orphan dialog)", () => {
    const book = new ApprovalBook();
    book.apply("s1", CD, { kind: "session", sessionId: "sid-1" });
    book.forget("s1");
    expect(book.view().pending).toHaveLength(0);
  });
});

describe("ApprovalBook: waiting for the human (D3-3)", () => {
  it("waitSettled resolves as soon as the decision lands", async () => {
    const book = new ApprovalBook();
    applyAdapter(book, "c1");
    const w = book.waitSettled("c1", 5_000);
    book.decide(book.view().pending[0].requestId, "allow");
    await expect(w).resolves.toBe("approved");
  });

  it("waitSettled gives up after the deadline and reports pending", async () => {
    const book = new ApprovalBook();
    applyAdapter(book, "c1");
    await expect(book.waitSettled("c1", 10)).resolves.toBe("pending");
  });

  it("onChange fires on apply / decide / revoke so the host can tell the GUI", () => {
    let n = 0;
    const book = new ApprovalBook({ onChange: () => n++ });
    applyAdapter(book, "c1");
    book.decide(book.view().pending[0].requestId, "allow");
    book.revoke(book.view().grants[0].key);
    expect(n).toBe(3);
  });
});
