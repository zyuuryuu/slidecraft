/**
 * issue-233-titleonly-legacy-plan-agreement.test.ts — #233: PR #219（#183）レビューの nit（R8）。
 *
 * #219 で `serializeLegacy`（tpl 無し）は先頭 title-only スライドの名前空間判定を実 placeholder idx
 * から行うよう修正済みで、issue-183-legacy-titleonly.test.ts の round-trip テストと既存の一般
 * agreement テスト（serializer-binding-plan.test.ts 等）は緑だった。ただし #183 のクラス（title-only
 * 先頭スライド）専用の legacy≡plan 一致テストは無かった。本テストは
 * serializeMd(deck)（tpl 無し＝legacy 経路）と serializeMd(deck, tpl)（serializeByPlan 経由）が
 * title-only 先頭スライドで同一出力になることを固定する。
 *
 * 手本: tests/serializer-binding-plan.test.ts の「ADR-0030 段階B — 健全デッキは BindingPlan 経由でも
 * byte-identical」。deck は issue-183-legacy-titleonly.test.ts と同じ MD（単独 `# 表紙` ／ 3枚デッキ）。
 *
 * 不変条件: 既存テスト全緑・byte-identical 経路不変・schema.ts 不変。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as S from "../src/mcp/session";
import { serializeMd } from "../src/engine/md-serializer";

const fx = (p: string) => readFileSync(resolve(__dirname, "fixtures/templates", p));

const SINGLE_MD = "# 表紙";
const THREE_SLIDE_MD = "# 表紙\n\n---\n\n# 中身\n\n- a\n\n---\n\n# 終わり";

describe.each([["Midnight_Executive_30_TemplateOnly.pptx"], ["Dirty_Legacy43_TemplateOnly.pptx"]])(
  "#233 — title-only 先頭スライド: legacy(tpl無し) と plan(tpl付き) の agreement — %s",
  (file) => {
    it("単独スライド「# 表紙」: serializeMd(deck) と serializeMd(deck, tpl) が byte-identical", async () => {
      const s = S.createSession();
      await S.newProject(s, fx(file), SINGLE_MD);
      const deck = S.getDeck(s);
      const withPlan = serializeMd(deck, { catalog: s.catalog!, layouts: s.template!.layouts });
      expect(withPlan).toBe(serializeMd(deck));
      expect(withPlan).toContain("# 表紙");
    });

    it("3枚デッキ（表紙/中身/終わり）: legacy と plan が byte-identical", async () => {
      const s = S.createSession();
      await S.newProject(s, fx(file), THREE_SLIDE_MD);
      const deck = S.getDeck(s);
      const withPlan = serializeMd(deck, { catalog: s.catalog!, layouts: s.template!.layouts });
      expect(withPlan).toBe(serializeMd(deck));
      expect(withPlan).toContain("# 表紙");
      expect(withPlan).toContain("# 中身");
      expect(withPlan).toContain("# 終わり");
    });
  },
);
