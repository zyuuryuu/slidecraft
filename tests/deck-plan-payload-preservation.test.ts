/**
 * deck-plan-payload-preservation.test.ts — #12 "generation payload drop" hardening.
 *
 * A weak/local model's DeckPlan output routinely carries structure the engine used
 * to SILENTLY DROP: a closing slide's subtitle/bullets, an unknown-kind slide's
 * body (in a non-`bullets` field), empty/duplicate section dividers, and ragged
 * tables. These are all deterministic-repair (harness over model) fixes: preserve
 * the DATA, drop only the noise. Adversarially reproduced via real probe payloads
 * before writing these gates ([[feedback_ai_proactive_adversary]]).
 */
import { describe, it, expect } from "vitest";
import { extractDeckPlan, deckPlanToDeck } from "../src/engine/deck-plan";
import { serializeMd } from "../src/engine/md-serializer";
import { parseMd } from "../src/engine/md-parser";

describe("#12-1 closing keeps its subtitle + bullets", () => {
  it("preserves a closing subtitle and bullets that were silently dropped", () => {
    const r = extractDeckPlan(JSON.stringify({ slides: [
      { kind: "closing", title: "ご清聴ありがとうございました", subtitle: "お問い合わせはこちら", bullets: ["sales@example.com", "03-1234-5678"] },
    ]}));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.plan.slides[0];
    expect(s.kind).toBe("closing");
    if (s.kind !== "closing") return;
    expect(s.subtitle).toBe("お問い合わせはこちら");
    expect(s.bullets).toEqual(["sales@example.com", "03-1234-5678"]);

    // …and they land in the SlideIR at idx 1: subtitle paragraph + bullet paragraphs.
    const ir = deckPlanToDeck(r.plan).slides[0];
    const sec = ir.placeholders.find((p) => p.idx === "1");
    expect(sec).toBeDefined();
    expect(sec!.paragraphs).toHaveLength(3);
    expect(sec!.paragraphs[0].segments[0].text).toBe("お問い合わせはこちら");
    expect(sec!.paragraphs[0].bullet).toBeFalsy();
    expect(sec!.paragraphs[1].bullet).toBe(true);
    expect(sec!.paragraphs[2].bullet).toBe(true);
  });

  it("a closing with only a title is unchanged (idx 0 alone)", () => {
    const ir = deckPlanToDeck({ slides: [{ kind: "closing", title: "Thanks" }] }).slides[0];
    expect(ir.placeholders.map((p) => p.idx)).toEqual(["0"]);
  });

  it("closing subtitle+bullets round-trip through Markdown losslessly", () => {
    const ir = deckPlanToDeck({ slides: [{ kind: "closing", title: "終", subtitle: "sub", bullets: ["a", "b"] }] });
    const back = parseMd(serializeMd(ir)).slides[0];
    const sec = back.placeholders.find((p) => p.idx === "1");
    expect(sec).toBeDefined();
    expect(sec!.paragraphs.map((p) => p.segments.map((x) => x.text).join(""))).toEqual(["sub", "a", "b"]);
    expect(sec!.paragraphs.map((p) => !!p.bullet)).toEqual([false, true, true]);
  });

  it("coerces closing bullets given as a newline string", () => {
    const r = extractDeckPlan(JSON.stringify({ slides: [
      { kind: "closing", title: "終", bullets: "一行目\n二行目" },
    ]}));
    expect(r.ok).toBe(true);
    if (r.ok && r.plan.slides[0].kind === "closing") {
      expect(r.plan.slides[0].bullets).toEqual(["一行目", "二行目"]);
    }
  });
});

describe("#12-2 unknown-kind slides keep their content (never vanish)", () => {
  it("an unknown kind + a titleless body-field slide both survive with content", () => {
    const r = extractDeckPlan(JSON.stringify({ slides: [
      { kind: "title", title: "デッキ" },
      { kind: "quote", text: "未来は予測するものではなく創るものだ" }, // unknown kind, body in `text`, no title
      { kind: "content", body: "要点1\n要点2" },                       // no title, body not `bullets`
      { kind: "closing", title: "終" },
    ]}));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.slides).toHaveLength(4); // NONE vanish

    const quote = r.plan.slides.find(
      (s): s is Extract<typeof s, { kind: "content" }> =>
        s.kind === "content" && s.bullets.some((b) => b.includes("未来")),
    );
    expect(quote).toBeDefined();

    const body = r.plan.slides.find(
      (s): s is Extract<typeof s, { kind: "content" }> =>
        s.kind === "content" && s.bullets.length === 2 && s.bullets[0].includes("要点1"),
    );
    expect(body).toBeDefined();
  });

  it("reads body from `content`/`points`/`items` alternate fields", () => {
    const r = extractDeckPlan(JSON.stringify({ slides: [
      { kind: "content", title: "A", content: ["x", "y"] },
      { kind: "content", title: "B", points: "p1\np2" },
      { kind: "content", title: "C", items: ["i1"] },
    ]}));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bullets = r.plan.slides.map((s) => (s.kind === "content" ? s.bullets : []));
    expect(bullets[0]).toEqual(["x", "y"]);
    expect(bullets[1]).toEqual(["p1", "p2"]);
    expect(bullets[2]).toEqual(["i1"]);
  });
});

describe("#12-3 empty / duplicate section dividers are collapsed", () => {
  it("drops empty-title sections and collapses consecutive duplicates", () => {
    const r = extractDeckPlan(JSON.stringify({ slides: [
      { kind: "section", title: "" },
      { kind: "section", title: "   " },
      { kind: "section", title: "第1部" },
      { kind: "section", title: "第1部" },
      { kind: "content", title: "本文", bullets: ["a"] },
    ]}));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sections = r.plan.slides.filter((s) => s.kind === "section");
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("第1部");
    expect(r.plan.slides).toHaveLength(2); // 1 section + 1 content
  });

  it("keeps distinct consecutive sections", () => {
    const r = extractDeckPlan(JSON.stringify({ slides: [
      { kind: "section", title: "第1部" },
      { kind: "section", title: "第2部" },
    ]}));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.slides).toHaveLength(2);
  });
});

describe("#12-4 ragged tables are rectangularized (non-lossy)", () => {
  it("pads short rows to a uniform width and loses no cell", () => {
    const r = extractDeckPlan(JSON.stringify({ slides: [
      { kind: "table", title: "比較", headers: ["項目", "A", "B"], rows: [["価格", "100"], ["機能", "x", "y", "z"], ["対応"]] },
    ]}));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = deckPlanToDeck(r.plan).slides[0].table!;
    const widths = new Set(t.rows.map((row) => row.length));
    expect(widths.size).toBe(1);        // every row the same width
    expect(t.rows[0].length).toBe(4);   // max(3 headers, 4-cell row)
    // the 4-cell data row is intact (nothing truncated)
    expect(t.rows.some((row) => row.join("") === "機能xyz")).toBe(true);
    // the 1-cell row is padded, not dropped
    expect(t.rows.some((row) => row[0] === "対応" && row.length === 4)).toBe(true);
  });

  it("leaves an already-rectangular table unchanged", () => {
    const t = deckPlanToDeck({ slides: [
      { kind: "table", title: "T", headers: ["a", "b"], rows: [["1", "2"], ["3", "4"]] },
    ]}).slides[0].table!;
    expect(t.rows).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });
});

describe("#12-5 (C) unrecoverable characters are dropped as a violation, never shown", () => {
  // json-salvage turns a malformed \uXXXX / lone surrogate into U+FFFD (`�`). Rather than SHOW that
  // marker (or a silently-wrong word), the deck-plan layer rejects the poisoned bullet/field — the
  // model violated "raw UTF-8, no \u escapes" so that unit is untrustworthy. A count is surfaced (告知).

  it("drops the bullet poisoned by a malformed \\u escape, keeps its siblings, and notifies", () => {
    const r = extractDeckPlan(String.raw`{"slides":[{"kind":"content","title":"テスト","bullets":["項目A","壊れた\u30cエスケープ","項目C"]}]}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.plan.slides[0];
    expect(s.kind).toBe("content");
    if (s.kind !== "content") return;
    expect(s.bullets).toEqual(["項目A", "項目C"]); // poisoned bullet gone
    expect(s.bullets.join("")).not.toContain("�"); // no marker leaks
    expect(r.notices?.length ?? 0).toBeGreaterThan(0); // 告知 present
  });

  it("blanks a title poisoned by a malformed escape but keeps the slide when body survives", () => {
    const r = extractDeckPlan(String.raw`{"slides":[{"kind":"content","title":"設\u30","bullets":["項目"]}]}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.plan.slides[0];
    if (s.kind !== "content") return;
    expect(s.title).toBe(""); // corrupt title rejected (violation), not shown as "設�" or "設u30"
    expect(s.bullets).toEqual(["項目"]); // clean body preserved
    const md = serializeMd(deckPlanToDeck(r.plan));
    expect(md).not.toContain("�"); // nothing corrupt reaches the deck
  });

  it("drops a slide whose only content is corrupt entirely (keeps the rest of the deck)", () => {
    const r = extractDeckPlan(String.raw`{"slides":[{"kind":"section","title":"\u30"},{"kind":"content","title":"生存","bullets":["x"]}]}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.slides).toHaveLength(1);
    expect(r.plan.slides[0].title).toBe("生存");
  });

  it("clean decks carry no notices", () => {
    const r = extractDeckPlan(JSON.stringify({ slides: [{ kind: "content", title: "A", bullets: ["x"] }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notices).toBeUndefined();
  });
});
