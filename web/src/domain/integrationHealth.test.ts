import { describe, expect, it } from "vitest";
import { calendarHealth, driveHealth, mapsHealth, messagingHealth, metaHealth, sheetsHealth, type IntegrationFacts } from "./integrationHealth";

const facts = (over: Partial<IntegrationFacts> = {}): IntegrationFacts => ({
  google: { connected: true, account_email: "x@y.com", calendar: true, drive: true, sheets: false, gmail: false },
  calendar: { scheduled: 5, synced: 5 },
  drive: { jobs: 7, with_folder: 0 },
  maps: { clients: 106, geocoded: 8 },
  meta: { last_sync: null, rows: 0 },
  ...over
});
const okCheck = { map: { ok: true }, geocode: { ok: true, status: "OK" } };

describe("mapsHealth", () => {
  it("names the Google error when the map itself is refused", () => {
    expect(mapsHealth(true, { map: { ok: false, code: "RefererNotAllowedMapError" }, geocode: { ok: true } }, null))
      .toEqual({ state: "error", key: "health.maps.map.RefererNotAllowedMapError", vars: { code: "RefererNotAllowedMapError" } });
    expect(mapsHealth(true, { map: { ok: false, code: "WeirdNewError" }, geocode: { ok: true } }, null).key).toBe("health.maps.map.unknown");
  });

  it("reports geocoding refusals with Google's own message", () => {
    const r = mapsHealth(true, { map: { ok: true }, geocode: { ok: false, status: "REQUEST_DENIED", message: "API keys with referer restrictions cannot be used with this API." } }, null);
    expect(r.state).toBe("error");
    expect(r.vars?.message).toContain("referer restrictions");
  });

  it("warns about records still without coordinates once both work", () => {
    expect(mapsHealth(true, okCheck, facts())).toEqual({ state: "warn", key: "health.maps.missing", vars: { missing: 98, total: 106 } });
    expect(mapsHealth(true, okCheck, facts({ maps: { clients: 3, geocoded: 3 } })).state).toBe("ok");
  });

  it("is off without a key, and pending while checking", () => {
    expect(mapsHealth(false, null, null).state).toBe("off");
    expect(mapsHealth(true, null, null).key).toBe("health.checking");
  });
});

describe("Google services", () => {
  it("calendar: ok when every scheduled job synced, warns when some didn't", () => {
    expect(calendarHealth(facts()).state).toBe("ok");
    expect(calendarHealth(facts({ calendar: { scheduled: 5, synced: 3 } }))).toEqual({ state: "warn", key: "health.calendar.partial", vars: { synced: 3, scheduled: 5 } });
  });

  it("a permission the Google account never granted is an error, even if switched on", () => {
    expect(sheetsHealth(facts())).toEqual({ state: "error", key: "health.google.noScope.sheets", vars: undefined });
  });

  it("drive: warns when jobs exist but none has a folder", () => {
    expect(driveHealth(facts()).key).toBe("health.drive.noFolders");
    expect(driveHealth(facts({ drive: { jobs: 7, with_folder: 2 } })).state).toBe("ok");
  });

  it("everything Google is off until the account is connected", () => {
    const off = facts({ google: { connected: false, account_email: "", calendar: false, drive: false, sheets: false, gmail: false } });
    for (const r of [calendarHealth(off), driveHealth(off), sheetsHealth(off)]) expect(r).toEqual({ state: "off", key: "health.google.notConnected", vars: undefined });
  });
});

describe("messagingHealth", () => {
  it("reads the server's status", () => {
    expect(messagingHealth({ sms: true, email: true, email_via: "gmail" }).state).toBe("ok");
    expect(messagingHealth({ sms: false, email: true, email_via: "resend" })).toEqual({ state: "warn", key: "health.messaging.emailOnly", vars: { via: "Resend" } });
    expect(messagingHealth({ sms: false, email: false, email_via: null }).state).toBe("off");
  });
});

describe("metaHealth", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  it("an enabled sync that never ran is an error", () => {
    expect(metaHealth(true, true, facts(), now).key).toBe("health.meta.never");
  });
  it("stale after two days, ok when fresh", () => {
    expect(metaHealth(true, true, facts({ meta: { last_sync: "2026-11-18T08:00:00Z", rows: 40 } }), now)).toEqual({ state: "warn", key: "health.meta.stale", vars: { days: 5 } });
    expect(metaHealth(true, true, facts({ meta: { last_sync: "2026-11-23T08:00:00Z", rows: 40 } }), now).state).toBe("ok");
  });
  it("off until switched on with an ad account", () => {
    expect(metaHealth(false, true, facts(), now).state).toBe("off");
  });
});
