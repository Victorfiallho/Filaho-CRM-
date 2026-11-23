import { describe, expect, it } from "vitest";
import { formatRecordParam, parseRecordParam, syncAction, type SyncState } from "./recordUrl";

const base: SyncState = { prevUrl: null, url: null, prevOpen: null, open: null, pending: null };

describe("record param", () => {
  it("round-trips, ids with colons included", () => {
    expect(parseRecordParam(formatRecordParam("lead", "lead_abc_123"))).toEqual({ type: "lead", id: "lead_abc_123" });
    expect(parseRecordParam("job:a:b")).toEqual({ type: "job", id: "a:b" });
  });

  it("rejects anything else", () => {
    for (const v of [null, "", "lead:", "quote:1", "lead_1"]) expect(parseRecordParam(v)).toBeNull();
  });
});

describe("syncAction", () => {
  it("opening a record puts it in the URL", () => {
    expect(syncAction({ ...base, open: "lead:1" })).toEqual({ kind: "push", value: "lead:1" });
  });

  it("doesn't push when the URL already has it (opened from a link)", () => {
    expect(syncAction({ ...base, prevUrl: "lead:1", url: "lead:1", open: "lead:1" })).toEqual({ kind: "none" });
  });

  it("closing it takes it out of the URL", () => {
    expect(syncAction({ ...base, prevUrl: "lead:1", url: "lead:1", prevOpen: "lead:1" })).toEqual({ kind: "clearUrl" });
  });

  it("Back (URL lost it) closes the record", () => {
    expect(syncAction({ ...base, prevUrl: "lead:1", prevOpen: "lead:1", open: "lead:1" })).toEqual({ kind: "closeModal" });
  });

  it("a link or Forward opens the record it names", () => {
    expect(syncAction({ ...base, url: "job:9" })).toEqual({ kind: "openFromUrl", value: "job:9" });
    expect(syncAction({ ...base, prevUrl: "lead:1", url: "lead:2", prevOpen: "lead:1", open: "lead:1" })).toEqual({ kind: "openFromUrl", value: "lead:2" });
  });

  it("retries a link once its data has loaded", () => {
    expect(syncAction({ ...base, prevUrl: "job:9", url: "job:9", pending: "job:9" })).toEqual({ kind: "openFromUrl", value: "job:9" });
  });

  it("closing and leaving the page in one go does nothing extra", () => {
    expect(syncAction({ ...base, prevUrl: "lead:1", url: null, prevOpen: "lead:1", open: null })).toEqual({ kind: "none" });
  });

  it("new, unsaved records stay out of the URL", () => {
    expect(syncAction({ ...base, prevOpen: null, open: null })).toEqual({ kind: "none" });
  });
});
