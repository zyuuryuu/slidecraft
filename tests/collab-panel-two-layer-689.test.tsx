/**
 * collab-panel-two-layer-689.test.tsx — #689: 協働パネルを 2 層にし、協働中に止まっているものを 1 か所で 1 行告げる。
 *
 *  1. 上の層は「状態 1 行＋停止」だけ。協働中（＝編集ロック中・collabEditLocked）や、許可したクライアントが
 *     あるとき（＝一度つないだ）は、登録の手順・接続テスト・HTTP 直結・許可の一覧は「接続の設定（初回だけ）」に
 *     畳まれ、描かれない。
 *  2. 一度もつないでいなければ（許可したクライアント 0・協働中でない）、接続の設定は開いている。
 *     「畳んだ」の記憶は ai-settings-fold の rememberFold と同じ規則（つないだら記憶を消す・未接続で畳んだときだけ記憶）。
 *  3. 協働中は、止まっているものと理由（＋停止までロックは解けない）が通知枠（NoticeSlot）に 1 行・［停止］付きで出る。
 *     承認待ちの帯と同時に 2 本にはならない（同じ枠の中で切り替え、隠れた方は「+1」）。パネル側には同じ文言を
 *     出さない（1 か所）。
 *  4. 承認待ちの件数は、パネルの状態行にも出る（2026-11-23 の申し送り）。
 * DOM 環境は無いので react-dom/server で描画して確かめる（先例 tests/collab-panel-stdio-front.test.tsx）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
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

describe("#689 下の層: 一度もつないでいなければ「接続の設定（初回だけ）」が開いている", () => {
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
});
