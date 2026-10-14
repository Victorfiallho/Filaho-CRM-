import { describe, expect, it } from "vitest";
import { detectLang, en, format, pt, translate, translatePlural, type MessageKey } from "./messages";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe("messages", () => {
  it("has a non-empty Portuguese string for every key, with the same placeholders", () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(pt[key], key).toBeTruthy();
      expect(placeholders(pt[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("defines every plural as a .one/.other pair", () => {
    // Keys named after stored data ids (cost category "other", transaction
    // types, field names) can end in ".other" without being plurals.
    const DATA_NAMESPACES = ["cat.", "txn.", "act.field."];
    for (const key of Object.keys(en)) {
      if (DATA_NAMESPACES.some(ns => key.startsWith(ns))) continue;
      if (key.endsWith(".one")) expect(Object.keys(en), key).toContain(key.replace(/\.one$/, ".other"));
      if (key.endsWith(".other")) expect(Object.keys(en), key).toContain(key.replace(/\.other$/, ".one"));
    }
  });
});

describe("translate", () => {
  it("fills placeholders and keeps unknown ones visible", () => {
    expect(format("{a} and {b}", { a: 1 })).toBe("1 and {b}");
    expect(translate("pt", "dash.followUps", { count: 3 })).toBe("Retornos · 3");
  });

  it("picks the plural form", () => {
    expect(translatePlural("en", "sub.clients", 1)).toBe("1 client");
    expect(translatePlural("en", "sub.clients", 23)).toBe("23 clients");
    expect(translatePlural("pt", "dash.alert.noContact", 2)).toBe("2 negócios sem contato");
  });

  it("uses the stored choice, else the device language", () => {
    expect(detectLang("pt", "en-US")).toBe("pt");
    expect(detectLang(null, "pt-BR")).toBe("pt");
    expect(detectLang(null, "en-GB")).toBe("en");
    expect(detectLang("fr", undefined)).toBe("en");
  });
});
