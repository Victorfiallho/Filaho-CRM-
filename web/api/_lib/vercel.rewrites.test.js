// The static landing pages under /book/ only work if their rewrite comes before
// the catch-all /book/:slug (which would 404 them as unknown booking slugs).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const webDir = new URL("../../", import.meta.url);
const { rewrites } = JSON.parse(readFileSync(new URL("vercel.json", webDir), "utf8"));
const at = source => rewrites.findIndex(r => r.source === source);

describe("vercel.json rewrites", () => {
  it("serves /book/wish-cabinets-v2 from its static page, ahead of /book/:slug", () => {
    const v2 = rewrites[at("/book/wish-cabinets-v2")];
    expect(v2).toBeTruthy();
    expect(at("/book/wish-cabinets-v2")).toBeLessThan(at("/book/:slug"));
    expect(existsSync(new URL(`public${v2.destination}`, webDir))).toBe(true);
  });
});
