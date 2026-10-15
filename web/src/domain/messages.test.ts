import { describe, expect, it } from "vitest";
import { avatarTone, dayLabel, daysAgo, initials, listTime } from "./messages";

const now = new Date(2026, 9, 15, 15, 0);
const at = (d: number, h = 10) => new Date(2026, 9, d, h, 30).toISOString();
const words = { today: "Hoje", yesterday: "Ontem" };

describe("message dates", () => {
  it("counts calendar days, not 24h blocks", () => {
    expect(daysAgo(at(15, 1), now)).toBe(0);
    expect(daysAgo(at(14, 23), now)).toBe(1);
  });

  it("labels today and yesterday, else a short date", () => {
    expect(dayLabel(at(15), "pt-BR", words, now)).toBe("Hoje");
    expect(dayLabel(at(14), "pt-BR", words, now)).toBe("Ontem");
    expect(dayLabel(at(10), "en-US", words, now)).toMatch(/Oct/);
  });

  it("list shows the time today and Ontem yesterday", () => {
    expect(listTime(at(15), "pt-BR", "Ontem", now)).toMatch(/10:30/);
    expect(listTime(at(14), "pt-BR", "Ontem", now)).toBe("Ontem");
  });
});

describe("avatars", () => {
  it("uses first and last initials", () => {
    expect(initials("Maria Fernanda Albuquerque")).toBe("MA");
    expect(initials("kevin")).toBe("K");
    expect(initials("")).toBe("?");
  });

  it("spreads names over several colors and is stable", () => {
    const names = ["Bob Lee", "Maria Fernanda Albuquerque", "Kevin", "Jane Doe", "Ana", "Carlos", "Lisa", "Sarah"];
    expect(new Set(names.map(avatarTone)).size).toBeGreaterThan(3);
    expect(avatarTone("Bob Lee")).toBe(avatarTone("Bob Lee"));
  });
});
