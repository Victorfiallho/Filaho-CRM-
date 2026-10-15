import { describe, expect, it } from "vitest";
import { addressOf, buildRaw, hasGmail, parseMessage, stripQuoted } from "./gmail.js";

const decodeRaw = raw => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const b64 = s => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

describe("buildRaw", () => {
  it("builds a UTF-8 plain-text email from the company's name and Gmail", () => {
    const raw = decodeRaw(buildRaw({ fromName: "Peach Fresh", fromEmail: "peachfresh.co@gmail.com", to: "jane@x.com", subject: "Orçamento", body: "Olá Jane!" }));
    expect(raw).toContain('From: "Peach Fresh" <peachfresh.co@gmail.com>');
    expect(raw).toContain("To: jane@x.com");
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from("Orçamento").toString("base64")}?=`);
    const body = raw.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Olá Jane!");
  });

  it("never lets a line break inject headers", () => {
    const raw = decodeRaw(buildRaw({ fromName: "X\r\nBcc: evil@x.com", fromEmail: "a@b.com", to: "c@d.com\r\nBcc: evil@x.com", subject: "Hi\nBcc: evil@x.com", body: "x" }));
    const headers = raw.split("\r\n\r\n")[0].split("\r\n");
    expect(headers.some(h => /^Bcc:/i.test(h))).toBe(false);
  });
});

describe("parsing Gmail messages", () => {
  it("reads addresses, subject and only the new text of a reply", () => {
    const m = parseMessage({
      id: "g1", threadId: "t1", internalDate: "1760000000000", snippet: "Sounds good",
      payload: {
        headers: [{ name: "From", value: "Jane Doe <Jane@X.com>" }, { name: "To", value: "Peach <peachfresh.co@gmail.com>" }, { name: "Subject", value: "Re: Quote" }],
        mimeType: "multipart/alternative",
        parts: [{ mimeType: "text/plain", body: { data: b64("Sounds good, see you Monday.\n\nOn Mon, Oct 13, 2026 at 9:00 AM Peach <peachfresh.co@gmail.com> wrote:\n> Here is your quote") } }]
      }
    });
    expect(m).toMatchObject({ id: "g1", threadId: "t1", from: "jane@x.com", to: ["peachfresh.co@gmail.com"], subject: "Re: Quote", text: "Sounds good, see you Monday." });
  });

  it("cuts quoted history in Portuguese and wrapped forms", () => {
    expect(stripQuoted("Combinado!\n\nEm seg., 13 de out. de 2026 Peach\n<peach@x.com> escreveu:\n> texto")).toBe("Combinado!");
    expect(stripQuoted("Ok\n> old")).toBe("Ok");
  });

  it("addressOf and scope check", () => {
    expect(addressOf("Bob <BOB@x.com>")).toBe("bob@x.com");
    expect(hasGmail("calendar.events gmail.send gmail.readonly")).toBe(true);
    expect(hasGmail("calendar.events drive.file")).toBe(false);
  });
});
