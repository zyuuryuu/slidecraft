// @vitest-environment jsdom
/**
 * collab-panel-two-layer-689.test.tsx — #689: 協働パネルを 2 層にし、協働中に止まっているものを 1 か所で 1 行告げる。
 *
 *  1. 上の層は「状態 1 行＋停止」だけ。協働中（＝編集ロック中・collabEditLocked）や、許可したクライアントが
 *     あるとき（＝一度つないだ）は、登録の手順・接続テスト・HTTP 直結・許可の一覧は「接続の設定」に
 *     畳まれ、描かれない。
 *  2. 一度もつないでいなければ（許可したクライアント 0・協働中でない）、接続の設定は開いている。
 *     「畳んだ」の記憶は ai-settings-fold の rememberFold と同じ規則（つないだら記憶を消す・未接続で畳んだときだけ記憶）。
 *  3. 協働中は、止まっているものと理由（＋停止までロックは解けない）が通知枠（NoticeSlot）に 1 行・［停止］付きで出る。
 *     承認待ちの帯と同時に 2 本にはならない（同じ枠の中で切り替え、隠れた方は「+1」）。パネル側には同じ文言を
 *     出さない（1 か所）。
 *  4. 承認待ちの件数は、パネルの状態行にも出る（2026-11-23 の申し送り）。
 *  5. （統括レビュー 要修正 a）停止・error・起動直後に「接続の設定」が開かない／ちらつかない。useCollab を
 *     実際に動かし（Tauri と host の 2 本の接続だけ偽物）、状態の移り変わりを jsdom で追う。
 * 静的な描画は react-dom/server（先例 tests/collab-panel-stdio-front.test.tsx）、状態の移り変わりは jsdom。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/i18n"; // init side-effect → useTranslation interpolates (ja default)
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";
import CollabPanel from "../src/components/CollabPanel";
import NoticeSlot from "../src/components/NoticeSlot";
import { noticeSlotPlan } from "../src/components/notice-slot-plan";
import { STDIO_SNIPPET } from "../src/components/collab-panel-snippets";
import {
  COLLAB_SETUP_FOLDED_KEY, collabEverConnected, initialSetupOpen, loadSetupFolded, rememberSetupFold,
} from "../src/components/collab-panel-view";
import { useCollab } from "../src/components/useCollab";
import type { StoredGrant } from "../src/mcp/host-approval";

// ── 5. の偽物: Tauri（起動・停止）と host への 2 本の接続（デッキの射影・承認の窓口）、キーチェーンだけ。
// 承認の窓口は本物と同じ順で動く: start() で 1 回目のスナップショット（この時点の host はまだ許可を持たない＝grants []）
// → useCollab がキーチェーンの許可を loadGrants で渡す（渡しても自分からは知らせない）。
const h = vi.hoisted(() => ({
  tauri: false,
  hostGrants: [] as StoredGrant[],
  keychain: Promise.resolve([] as StoredGrant[]),
  proj: null as null | { onStatus: (s: string, d?: string) => void },
  chan: null as null | { onView: (v: unknown) => void; onAiActive: () => void },
}));
vi.mock("../src/ipc/commands", async (orig) => ({ ...(await orig<object>()), runningInTauri: () => h.tauri }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => (cmd === "start_collab" ? { url: "http://127.0.0.1:1/mcp", token: "t", guiToken: "g" } : undefined),
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: async () => new Response() }));
vi.mock("../src/components/collab-seed", () => ({ seedHost: async () => ({}) }));
vi.mock("../src/ipc/client-grants-store", () => ({
  loadClientGrants: () => h.keychain, addClientGrant: async () => {}, removeClientGrant: async () => {},
}));
vi.mock("../src/ipc/collab-projection", () => ({
  CollabProjection: class {
    constructor(private o: { onStatus: (s: string, d?: string) => void }) { h.proj = o; }
    async start() { this.o.onStatus("connected"); }
    async stop() {}
    setTargetDoc() {}
  },
}));
vi.mock("../src/ipc/collab-approvals", () => ({
  CollabApprovals: class {
    constructor(private o: { onView: (v: unknown) => void; onAiActive: () => void }) { h.chan = o; }
    private snap() {
      const grants = h.hostGrants.map((g) => ({ key: g.clientId, name: g.name, version: g.version, fingerprint: g.clientId, kind: "adapter" }));
      return { pending: [], grants, denyAll: false, aiActive: false };
    }
    async start() { this.o.onView(this.snap()); }
    async stop() {}
    async refresh() { const v = this.snap(); this.o.onView(v); return v; }
    async loadGrants(g: StoredGrant[]) { h.hostGrants = g; }
    async reportSeed() {}
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};
const grant = { key: "k1", name: "Claude Desktop", version: "1.0", fingerprint: "cid-0123", kind: "adapter" as const };
const base = {
  onClose: noop, available: true, status: "connected" as const, url: "http://127.0.0.1:1/mcp", token: "t",
  onStart: noop, onStop: noop, onRevoke: noop, onFollowAiChange: noop, followAi: true,
};
const SETUP = ja.collabPanel.setupSummary;
const stopButtons = (html: string) => html.split(`>${ja.collabPanel.stopButton}</button>`).length - 1;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("#689 上の層: 協働を開始した後の最初の画面は「状態＋停止」だけ", () => {
  const html = renderToStaticMarkup(<CollabPanel {...base} aiActive grants={[grant]} />);

  it("状態行（協働中・許可したクライアント名）と 停止 が 1 つ", () => {
    expect(html).toContain('data-testid="collab-status"');
    expect(html).toContain(ja.collabPanel.statusCollaborating);
    expect(html).toContain("Claude Desktop");
    expect(stopButtons(html)).toBe(1);
  });

  it("登録の手順・接続テスト・.mcpb・HTTP 直結・許可の一覧・追随の切り替えは畳まれて描かれない", () => {
    expect(html).toContain(SETUP); // the fold's own toggle is there…
    expect(html).not.toContain(STDIO_SNIPPET); // …but nothing inside it
    expect(html).not.toContain(ja.collabPanel.doctorButton);
    expect(html).not.toContain(ja.collabPanel.mcpbLabel);
    expect(html).not.toContain(ja.collabPanel.advancedHttpSummary);
    expect(html).not.toContain(ja.collabPanel.grantsSummary.replace("{{count}}", "1"));
    expect(html).not.toContain(ja.collabPanel.followAi);
  });

  it("止まっているものの 1 行はパネルに出さない（通知枠の 1 か所だけ）", () => {
    expect(html).not.toContain(ja.collabPanel.lockedNotice);
  });

  it("許可したクライアントがあれば（一度つないだ）、AI 待ちでも畳む", () => {
    const waiting = renderToStaticMarkup(<CollabPanel {...base} aiActive={false} grants={[grant]} />);
    expect(waiting).toContain(ja.collabPanel.waitingForAi);
    expect(waiting).not.toContain(STDIO_SNIPPET);
  });

  it("承認待ちの件数を状態行に出す", () => {
    const pending = renderToStaticMarkup(<CollabPanel {...base} aiActive grants={[grant]} pendingCount={2} />);
    expect(pending).toContain(ja.collabPanel.pendingCount.replace("{{count}}", "2"));
    expect(html).not.toContain(ja.collabPanel.pendingCount.replace("{{count}}", "0"));
  });
});

describe("#689 下の層: 一度もつないでいなければ「接続の設定」が開いている", () => {
  it("許可したクライアント 0・協働中でない → 登録の手順と接続テストが見える", () => {
    const html = renderToStaticMarkup(<CollabPanel {...base} aiActive={false} grants={[]} />);
    expect(html).toContain(SETUP);
    expect(html).toContain(STDIO_SNIPPET);
    expect(html).toContain(ja.collabPanel.doctorButton);
    expect(html).toContain(ja.collabPanel.mcpbLabel);
  });

  it("ブラウザ版（協働が使えない）でも登録の手順は開いている", () => {
    const html = renderToStaticMarkup(<CollabPanel {...base} available={false} status="idle" />);
    expect(html).toContain(STDIO_SNIPPET);
    expect(stopButtons(html)).toBe(0);
  });

  it("一度つないだか = 協働中 か 許可したクライアントがある", () => {
    expect(collabEverConnected({ locked: false, grants: undefined })).toBe(false);
    expect(collabEverConnected({ locked: false, grants: [] })).toBe(false);
    expect(collabEverConnected({ locked: true, grants: [] })).toBe(true);
    expect(collabEverConnected({ locked: false, grants: [grant] })).toBe(true);
  });

  it("開閉の初期値と「畳んだ」の記憶は rememberFold と同じ規則", () => {
    expect(initialSetupOpen(false, false)).toBe(true); // never connected, no memory → open
    expect(initialSetupOpen(false, true)).toBe(false); // never connected, folded before → stays folded
    expect(initialSetupOpen(true, false)).toBe(false); // connected before → folded
    expect(rememberSetupFold(false, false, false)).toBe(true); // folded while never connected → remember
    expect(rememberSetupFold(true, true, false)).toBe(false); // opened → forget
    expect(rememberSetupFold(true, null, true)).toBe(false); // connected → forget (#743 rule)
    expect(rememberSetupFold(true, null, false)).toBe(true); // nothing happened → keep
  });

  it("記憶は 1 つの localStorage キー。読めなくても「記憶なし」で動く", () => {
    const store = new Map<string, string>([[COLLAB_SETUP_FOLDED_KEY, "1"]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: noop, removeItem: noop });
    expect(loadSetupFolded()).toBe(true);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(loadSetupFolded()).toBe(false);
  });
});

describe("#689 通知枠: 協働中は止まっているものと理由を 1 行で", () => {
  const empty = { update: null, intake: { busy: null, result: null, onDismiss: noop }, adjust: null };

  it("協働中: 止まっているもの・理由・停止までロックが続くことを 1 本の帯に、［停止］付きで", () => {
    const html = renderToStaticMarkup(<NoticeSlot {...empty} collabLock={{ onStop: noop }} />);
    expect(html).toContain('data-notice="collab"');
    expect(html).toContain(ja.collabPanel.lockedNotice);
    expect(stopButtons(html)).toBe(1);
    expect((html.match(/role="(status|region)"/g) ?? []).length).toBe(1);
  });

  it("協働中でなければ出ない", () => {
    expect(renderToStaticMarkup(<NoticeSlot {...empty} collabLock={null} />)).toBe("");
  });

  it("承認待ちと同時でも帯は 1 本（承認待ちが先・協働中の 1 行は「+1」で待つ）", () => {
    expect(noticeSlotPlan({ approval: true, collab: true, adjusting: false, intake: false, update: true }))
      .toEqual({ shown: "approval", hidden: ["collab", "update"] });
    const html = renderToStaticMarkup(<NoticeSlot {...empty} approval={{ count: 1 }} collabLock={{ onStop: noop }} />);
    expect(html).toContain('data-notice="approval"');
    expect(html).not.toContain(ja.collabPanel.lockedNotice);
    expect(html).toContain(">+1<");
  });

  it("ja / en の文言がそろっている（隠れた帯の名前も）", () => {
    expect(en.collabPanel.lockedNotice).toBeTruthy();
    expect(Object.keys(en.noticeSlot.kind).sort()).toEqual(Object.keys(ja.noticeSlot.kind).sort());
    expect(ja.noticeSlot.kind).toHaveProperty("collab");
  });

  // 統括レビュー 要修正 c: 帯は「1 か所で告げる」役なので、editLocked が止める 8 か所をすべて言う
  // （開く・原稿入力・テンプレート〔マスターのメニュー〕・タブを閉じる・スライドの追加〔便利スライドの生成〕・
  // 削除／複製／並べ替え・複数スライドの一括 AI 編集・AI の提案の採用）。
  it("帯の文言は止まっている 8 か所をすべて言う（ja・en）", () => {
    for (const w of ["追加", "削除", "複製", "並べ替え", "タブ", "開く", "テンプレート", "原稿", "一括", "提案", "停止まで"]) {
      expect(ja.collabPanel.lockedNotice, w).toContain(w);
    }
    for (const w of ["adding", "deleting", "duplicating", "reordering", "tabs", "opening", "templates", "draft", "bulk", "suggestions", "until you Stop"]) {
      expect(en.collabPanel.lockedNotice, w).toContain(w);
    }
  });
});

describe("#689 裁定: 見出しは「接続の設定」、中身は 登録 → 接続テスト → HTTP 直結 → 許可 → 追随 の順", () => {
  it("見出しに「初回だけ」を付けない（中に日々の設定も入っているため）", () => {
    expect(ja.collabPanel.setupSummary).toBe("接続の設定");
    expect(en.collabPanel.setupSummary).toBe("Connection setup");
  });

  it("開いたときの並び", () => {
    localStorage.clear();
    const html = renderToStaticMarkup(<CollabPanel {...base} aiActive={false} grants={[]} />);
    const order = [STDIO_SNIPPET, ja.collabPanel.doctorButton, ja.collabPanel.advancedHttpSummary,
      ja.collabPanel.grantsSummary.replace("{{count}}", "0"), ja.collabPanel.followAi].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0), String(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

// ── 5. 統括レビュー 要修正 a: useCollab を動かし、App と同じ配線でパネルを描く。
function Harness() {
  const c = useCollab({ applyDeck: noop, deck: null, templateData: null, templateName: "", masters: [], getMasterBytes: async () => new Uint8Array() });
  return (
    <CollabPanel
      embedded onClose={noop} available={c.available} status={c.status} url={c.url} token={c.token} error={c.error}
      onStart={() => void c.start()} onStop={() => void c.stop()} aiActive={c.aiActive} grants={c.grants} grantsRead={c.grantsRead}
      onRevoke={noop} pendingCount={c.approvals?.pending.length ?? 0} followAi onFollowAiChange={noop}
    />
  );
}

describe("#689 要修正 a: 停止・error・起動直後に「接続の設定」が開かない（ちらつかない）", () => {
  const stored: StoredGrant = { name: "Claude Desktop", version: "1.0", clientId: "cid-0123", secret: "s" };
  let root: Root | null = null;
  let release: (g: StoredGrant[]) => void = noop;
  // 開いたことが一度でもあれば記録する（ちらつきも「開いた」として捕まえる）。
  let everOpened = false;
  let observer: MutationObserver | null = null;
  const toggle = () => document.querySelector("[data-testid=collab-setup-toggle]");
  const isOpen = () => toggle()?.getAttribute("aria-expanded") === "true";
  const flush = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
  const statusText = () => document.querySelector("[data-testid=collab-status]")?.textContent ?? "";

  async function mount(node: ReactElement) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    observer = new MutationObserver(() => { if (isOpen()) everOpened = true; });
    observer.observe(host, { subtree: true, childList: true, attributes: true });
    root = createRoot(host);
    await act(async () => root!.render(node));
    if (isOpen()) everOpened = true;
  }

  beforeEach(() => {
    localStorage.clear();
    everOpened = false;
    h.tauri = true;
    h.hostGrants = [];
    h.keychain = new Promise((r) => { release = r; });
  });
  afterEach(async () => {
    observer?.disconnect();
    if (root) await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = "";
    h.tauri = false;
  });

  it("起動直後（許可をまだ読んでいない）→ 開かない → 許可が届いても畳んだまま", async () => {
    await mount(<Harness />);
    await flush();
    expect(statusText()).toContain(ja.collabPanel.waitingForAi); // host は起動し、最初のスナップショット（grants []）も届いた
    expect(isOpen()).toBe(false);
    release([stored]);
    await flush();
    expect(statusText()).toContain("Claude Desktop");
    expect(isOpen()).toBe(false);
    expect(everOpened).toBe(false);
  });

  it("許可あり・協働中 → 停止（idle）→ 畳んだまま", async () => {
    release([stored]);
    await mount(<Harness />);
    await flush();
    await act(async () => h.chan!.onAiActive());
    await flush();
    expect(statusText()).toContain(ja.collabPanel.statusCollaborating);
    const stop = [...document.querySelectorAll("button")].find((b) => b.textContent === ja.collabPanel.stopButton)!;
    await act(async () => stop.click());
    await flush();
    expect(statusText()).toContain(ja.collabPanel.statusDisconnected);
    expect(isOpen()).toBe(false);
    expect(everOpened).toBe(false);
  });

  it("許可あり → host の error → 畳んだまま", async () => {
    release([stored]);
    await mount(<Harness />);
    await flush();
    await act(async () => h.proj!.onStatus("error", "boom"));
    await flush();
    expect(statusText()).toContain(ja.collabPanel.statusError);
    expect(isOpen()).toBe(false);
    expect(everOpened).toBe(false);
  });

  it("本当に初回（許可 0 を読み終えた・協働なし）→ 開く", async () => {
    await mount(<Harness />);
    await flush();
    expect(isOpen()).toBe(false); // 読み終えるまでは決めない
    release([]);
    await flush();
    expect(isOpen()).toBe(true);
    expect(document.body.textContent).toContain(ja.collabPanel.doctorButton);
  });
});
