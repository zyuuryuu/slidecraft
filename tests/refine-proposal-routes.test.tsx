/**
 * RefineProposal — #106 P4 (4): the change list shows which route each AI change took (ops vs full
 * Markdown) with its skipped-op count and warnings, and an AI reply that changed nothing but carried
 * notices (every op skipped, malformed-ops fallback) is still listed — never silent.
 * Rendered via react-dom/server (no interaction needed).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/i18n"; // init → ja strings
import RefineProposal from "../src/components/RefineProposal";
import type { RefineResult } from "../src/engine/refine";

const deck = { slides: [] };
const noop = () => {};

describe("RefineProposal shows the route per AI change", () => {
  it("labels an ops change with its route and skipped count, and lists its warnings", () => {
    const proposal: RefineResult = {
      deck, converged: true, iterations: 1,
      changes: [
        { slideIndex: 1, lever: "edit", kind: "ai", beforeMd: "# a", afterMd: "# b", warnings: ['setField: idx "99" はこのスライドにないため適用しませんでした'] },
        { slideIndex: 2, lever: "edit", kind: "ai", beforeMd: "# c", afterMd: "# d" },
      ],
      routes: [
        { slideIndex: 1, route: "field-ops", skipped: 1, applied: true },
        { slideIndex: 2, route: "markdown", skipped: 0, applied: true },
      ],
    };
    const html = renderToStaticMarkup(<RefineProposal proposal={proposal} onAccept={noop} onCancel={noop} />);
    expect(html).toContain("部分編集（文面）");
    expect(html).toContain("スキップ 1");
    expect(html).toContain("全文編集");
    expect(html).toContain('idx &quot;99&quot; はこのスライドにないため');
  });

  it("lists an unapplied reply's notices even when there is no change", () => {
    const proposal: RefineResult = {
      deck, converged: true, iterations: 1, changes: [],
      routes: [{ slideIndex: 3, route: "field-ops", skipped: 1, applied: false, notices: ["setField: idx \"9\" は無い"] }],
    };
    const html = renderToStaticMarkup(<RefineProposal proposal={proposal} onAccept={noop} onCancel={noop} />);
    expect(html).toContain("スライド 4");
    expect(html).toContain("適用されませんでした");
    expect(html).toContain("setField: idx &quot;9&quot; は無い");
  });

  it("a deterministic-only proposal (no routes) renders as before — no route label", () => {
    const proposal: RefineResult = {
      deck, converged: true, iterations: 1,
      changes: [{ slideIndex: 0, lever: "visualize", kind: "deterministic", beforeMd: "# a", afterMd: "# b" }],
    };
    const html = renderToStaticMarkup(<RefineProposal proposal={proposal} onAccept={noop} onCancel={noop} />);
    expect(html).not.toContain("全文編集");
    expect(html).not.toContain("部分編集");
  });
});
