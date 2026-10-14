import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./chatMarkdown";

describe("parseInline", () => {
  it("reads bold, code and record links", () => {
    expect(parseInline("**2** clients: [Bob Lee](client:c1) and [Kitchen](lead:l_9) `x`")).toEqual([
      { kind: "bold", text: "2" },
      { kind: "text", text: " clients: " },
      { kind: "record", text: "Bob Lee", type: "customer", id: "c1" },
      { kind: "text", text: " and " },
      { kind: "record", text: "Kitchen", type: "lead", id: "l_9" },
      { kind: "text", text: " " },
      { kind: "code", text: "x" }
    ]);
  });

  it("keeps only http(s) links; anything else is plain text", () => {
    expect(parseInline("[site](https://example.com)")).toEqual([{ kind: "link", text: "site", href: "https://example.com" }]);
    expect(parseInline("[bad](javascript:alert(1))")[0]).toMatchObject({ kind: "text" });
    expect(parseInline("<img src=x>")).toEqual([{ kind: "text", text: "<img src=x>" }]);
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs and lists", () => {
    const blocks = parseMarkdown("Two clients:\n\n- [Bob](client:c1) — 2 deals\n- Ana\n\n1. first\n2. second\nDone.");
    expect(blocks.map(b => b.kind)).toEqual(["p", "ul", "ol", "p"]);
    expect(blocks[1]).toMatchObject({ kind: "ul", items: [[{ kind: "record", id: "c1" }, { kind: "text", text: " — 2 deals" }], [{ kind: "text", text: "Ana" }]] });
  });

  it("turns headings into bold lines", () => {
    expect(parseMarkdown("### Today")).toEqual([{ kind: "p", lines: [[{ kind: "bold", text: "Today" }]] }]);
  });
});
