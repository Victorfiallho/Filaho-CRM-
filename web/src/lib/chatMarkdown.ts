// The bit of Markdown the assistant is told to use (paragraphs, bullet and
// numbered lists, **bold**, `code`, record links), parsed into data that
// ChatWidget renders as React elements. Never HTML, so text from the model
// or from records can't inject markup. Links to "lead:<id>", "client:<id>"
// or "job:<id>" become buttons that open the record. Any other link shows
// its label only: record text from the public booking page reaches the
// model, and a clickable external link could carry client data out.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "record"; text: string; type: "lead" | "customer" | "job"; id: string };

export type Block =
  | { kind: "p"; lines: Inline[][] }
  | { kind: "ul" | "ol"; items: Inline[][] };

const RECORD_TYPES: Record<string, "lead" | "customer" | "job"> = { lead: "lead", client: "customer", customer: "customer", job: "job" };

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else {
      const label = m[3].replace(/\*\*/g, "");
      const target = m[4];
      const rec = /^(lead|client|customer|job):(.+)$/.exec(target);
      if (rec) out.push({ kind: "record", text: label, type: RECORD_TYPES[rec[1]], id: rec[2] });
      else out.push({ kind: "text", text: label });
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: Inline[][] = [];
  let list: { kind: "ul" | "ol"; items: Inline[][] } | null = null;
  const flushPara = () => { if (para.length) blocks.push({ kind: "p", lines: para }); para = []; };
  const flushList = () => { if (list) blocks.push(list); list = null; };

  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      flushPara();
      if (list && list.kind !== kind) flushList();
      if (!list) list = { kind, items: [] };
      list.items.push(parseInline((bullet || numbered)![1]));
      continue;
    }
    flushList();
    // "### Heading" reads as a bold line.
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    para.push(heading ? [{ kind: "bold", text: heading[1].replace(/\*\*/g, "") }] : parseInline(line.trim()));
  }
  flushPara();
  flushList();
  return blocks;
}
