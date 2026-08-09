/**
 * WORKOUT-V2-01D-FIX2 – timezone / DST unit coverage
 *
 * Pure unit tests – no database required.
 * All instants are fixed (no Date.now()); server process TZ independence
 * is verified by temporarily overriding process.env.TZ.
 *
 * Day-index convention (same as production):  Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dateOnlyInTimeZone,
  dayIndexInTimeZone,
  normalizeTimeZone,
} from "../domain/workout-adaptation.fingerprint";

// ---------------------------------------------------------------------------
// Day-index constants
// ---------------------------------------------------------------------------
const MON = 0;
const TUE = 1;
const WED = 2;
const THU = 3;
const FRI = 4;
const SAT = 5;
const SUN = 6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace process.env.TZ for a block; restores original value in afterAll. */
let savedTZ: string | undefined;

function setProcessTZ(tz: string) {
  savedTZ = process.env.TZ;
  process.env.TZ = tz;
}

function restoreProcessTZ() {
  if (savedTZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = savedTZ;
  }
  savedTZ = undefined;
}

// ---------------------------------------------------------------------------
// 2026 date anchors
// ---------------------------------------------------------------------------
//
// 2026-01-01 = Thursday  (2025-01-01 = Wed, +1 day for non-leap year)
// 2026-01-05 = Monday    (Jan 1=Thu, +4 = Mon)
// 2026-01-11 = Sunday    (Jan 5=Mon, +6 = Sun)
//
// Amsterdam DST 2026:
//   Spring forward: Sunday 2026-03-29 02:00 local → 03:00 CEST (at 01:00 UTC)
//   Fall back:      Sunday 2026-10-25 03:00 local → 02:00 CET  (at 01:00 UTC)

// ---------------------------------------------------------------------------
// Europe/Moscow UTC+3, no DST
// ---------------------------------------------------------------------------

describe("dayIndexInTimeZone – Europe/Moscow 2026", () => {
  it("2026-01-05T21:30Z → Moscow Tue 00:30 → dayIndex=1 (TUE)", () => {
    // UTC Mon Jan 5 21:30 + 3h = Tue Jan 6 00:30 Moscow
    const instant = new Date("2026-01-05T21:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(MON);
    expect(dayIndexInTimeZone("Europe/Moscow", instant)).toBe(TUE);
  });

  it("2026-01-11T21:30Z → Moscow Mon 00:30 → dayIndex=0 (MON)", () => {
    // UTC Sun Jan 11 21:30 + 3h = Mon Jan 12 00:30 Moscow
    const instant = new Date("2026-01-11T21:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Moscow", instant)).toBe(MON);
  });

  it("midnight boundary: 2026-01-04T20:59Z → Moscow Sun 23:59 → dayIndex=6 (SUN)", () => {
    // UTC Sun Jan 4 20:59 + 3h = Sun Jan 4 23:59 Moscow
    const instant = new Date("2026-01-04T20:59:59.999Z");
    expect(dayIndexInTimeZone("Europe/Moscow", instant)).toBe(SUN);
  });

  it("midnight boundary: 2026-01-04T21:00Z → Moscow Mon 00:00 → dayIndex=0 (MON)", () => {
    // UTC Sun Jan 4 21:00 + 3h = Mon Jan 5 00:00 Moscow
    const instant = new Date("2026-01-04T21:00:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Moscow", instant)).toBe(MON);
  });

  it("UTC midnight Jan 5: 2026-01-05T00:00Z → Moscow Mon 03:00 → dayIndex=0 (MON)", () => {
    const instant = new Date("2026-01-05T00:00:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(MON);
    expect(dayIndexInTimeZone("Europe/Moscow", instant)).toBe(MON);
  });

  it("UTC end of Mon Jan 5: 2026-01-05T23:59Z → Moscow Tue 02:59 → dayIndex=1 (TUE)", () => {
    const instant = new Date("2026-01-05T23:59:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(MON);
    expect(dayIndexInTimeZone("Europe/Moscow", instant)).toBe(TUE);
  });
});

describe("dateOnlyInTimeZone – Europe/Moscow 2026", () => {
  it("2026-01-05T21:30Z → UTC '2026-01-05', Moscow '2026-01-06'", () => {
    const instant = new Date("2026-01-05T21:30:00.000Z");
    expect(dateOnlyInTimeZone("UTC", instant)).toBe("2026-01-05");
    expect(dateOnlyInTimeZone("Europe/Moscow", instant)).toBe("2026-01-06");
  });

  it("2026-01-11T21:30Z → UTC '2026-01-11', Moscow '2026-01-12'", () => {
    const instant = new Date("2026-01-11T21:30:00.000Z");
    expect(dateOnlyInTimeZone("UTC", instant)).toBe("2026-01-11");
    expect(dateOnlyInTimeZone("Europe/Moscow", instant)).toBe("2026-01-12");
  });

  it("midnight edge: 2026-01-04T20:59Z → Moscow '2026-01-04'", () => {
    const instant = new Date("2026-01-04T20:59:59.999Z");
    expect(dateOnlyInTimeZone("Europe/Moscow", instant)).toBe("2026-01-04");
  });

  it("midnight edge: 2026-01-04T21:00Z → Moscow '2026-01-05'", () => {
    const instant = new Date("2026-01-04T21:00:00.000Z");
    expect(dateOnlyInTimeZone("Europe/Moscow", instant)).toBe("2026-01-05");
  });
});

// ---------------------------------------------------------------------------
// Europe/Amsterdam DST 2026
// ---------------------------------------------------------------------------

describe("dayIndexInTimeZone – Europe/Amsterdam DST 2026 spring", () => {
  // Spring forward: 2026-03-29 02:00 local → 03:00 (01:00 UTC gap)

  it("before spring: 2026-03-29T00:30Z = 01:30 CET Amsterdam → Sunday (6)", () => {
    // Still in CET (UTC+1) before 01:00 UTC
    const instant = new Date("2026-03-29T00:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(SUN);
  });

  it("at spring forward: 2026-03-29T01:00Z = 03:00 CEST Amsterdam → Sunday (6)", () => {
    // At exactly 01:00 UTC clocks jump from 02:00 CET → 03:00 CEST
    const instant = new Date("2026-03-29T01:00:00.000Z");
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(SUN);
  });

  it("after spring: 2026-03-29T01:30Z = 03:30 CEST Amsterdam → Sunday (6)", () => {
    const instant = new Date("2026-03-29T01:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(SUN);
  });

  it("day before spring: 2026-03-28T23:30Z = 00:30 CET Mar 29 Amsterdam → Sunday (6)", () => {
    // Saturday UTC night → already Sunday in CET (+1h)
    const instant = new Date("2026-03-28T23:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SAT);
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(SUN);
  });

  it("dayIndex stable across spring-forward offset change for local calendar day", () => {
    // Both instants fall on Sunday Mar 29 in Amsterdam regardless of CET vs CEST
    const beforeForward = new Date("2026-03-29T00:30:00.000Z"); // 01:30 CET (UTC+1)
    const afterForward = new Date("2026-03-29T01:30:00.000Z");  // 03:30 CEST (UTC+2)
    const before = dayIndexInTimeZone("Europe/Amsterdam", beforeForward);
    const after = dayIndexInTimeZone("Europe/Amsterdam", afterForward);
    expect(before).toBe(SUN);
    expect(after).toBe(SUN);
    expect(before).toBe(after);
  });
});

describe("dayIndexInTimeZone – Europe/Amsterdam DST 2026 fall", () => {
  // Fall back: 2026-10-25 03:00 CEST → 02:00 CET (01:00 UTC)

  it("before fall-back: 2026-10-25T00:30Z = 02:30 CEST Amsterdam → Sunday (6)", () => {
    // CEST (UTC+2) still active
    const instant = new Date("2026-10-25T00:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(SUN);
  });

  it("at fall-back: 2026-10-25T01:00Z = 02:00 CET Amsterdam → Sunday (6)", () => {
    // Clocks fall back to 02:00 CET
    const instant = new Date("2026-10-25T01:00:00.000Z");
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(SUN);
  });

  it("after fall-back: 2026-10-25T01:30Z = 02:30 CET Amsterdam → Sunday (6)", () => {
    // CET (UTC+1) now active
    const instant = new Date("2026-10-25T01:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(SUN);
  });

  it("day after fall-back: 2026-10-26T00:30Z = 01:30 CET Monday → Monday (0)", () => {
    const instant = new Date("2026-10-26T00:30:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(MON);
    expect(dayIndexInTimeZone("Europe/Amsterdam", instant)).toBe(MON);
  });

  it("dayIndex stable across fall-back offset change for local calendar day", () => {
    // Both instants fall on Sunday Oct 25 in Amsterdam regardless of CEST vs CET
    const beforeFallBack = new Date("2026-10-25T00:30:00.000Z"); // 02:30 CEST (UTC+2)
    const afterFallBack = new Date("2026-10-25T01:30:00.000Z");  // 02:30 CET (UTC+1)
    const before = dayIndexInTimeZone("Europe/Amsterdam", beforeFallBack);
    const after = dayIndexInTimeZone("Europe/Amsterdam", afterFallBack);
    expect(before).toBe(SUN);
    expect(after).toBe(SUN);
    expect(before).toBe(after);
  });
});

describe("dateOnlyInTimeZone – Europe/Amsterdam DST 2026", () => {
  it("spring-forward date: 2026-03-28T23:00Z → UTC '2026-03-28', Amsterdam '2026-03-29'", () => {
    // Saturday UTC night → Sunday in Amsterdam (00:00 CET)
    const instant = new Date("2026-03-28T23:00:00.000Z");
    expect(dateOnlyInTimeZone("UTC", instant)).toBe("2026-03-28");
    expect(dateOnlyInTimeZone("Europe/Amsterdam", instant)).toBe("2026-03-29");
  });

  it("before spring: 2026-03-29T00:30Z → Amsterdam '2026-03-29'", () => {
    const instant = new Date("2026-03-29T00:30:00.000Z");
    expect(dateOnlyInTimeZone("Europe/Amsterdam", instant)).toBe("2026-03-29");
  });

  it("after spring: 2026-03-29T01:30Z → Amsterdam '2026-03-29'", () => {
    const instant = new Date("2026-03-29T01:30:00.000Z");
    expect(dateOnlyInTimeZone("Europe/Amsterdam", instant)).toBe("2026-03-29");
  });

  it("fall-back date: before fall 2026-10-25T00:30Z → Amsterdam '2026-10-25'", () => {
    const instant = new Date("2026-10-25T00:30:00.000Z");
    expect(dateOnlyInTimeZone("Europe/Amsterdam", instant)).toBe("2026-10-25");
  });

  it("fall-back date: after fall 2026-10-25T01:30Z → Amsterdam '2026-10-25'", () => {
    const instant = new Date("2026-10-25T01:30:00.000Z");
    expect(dateOnlyInTimeZone("Europe/Amsterdam", instant)).toBe("2026-10-25");
  });

  it("night before fall-back: 2026-10-24T22:00Z → UTC '2026-10-24', Amsterdam '2026-10-25'", () => {
    // CEST (UTC+2): 22:00 + 2h = 00:00 Amsterdam Oct 25
    const instant = new Date("2026-10-24T22:00:00.000Z");
    expect(dateOnlyInTimeZone("UTC", instant)).toBe("2026-10-24");
    expect(dateOnlyInTimeZone("Europe/Amsterdam", instant)).toBe("2026-10-25");
  });
});

// ---------------------------------------------------------------------------
// UTC baseline
// ---------------------------------------------------------------------------

describe("dayIndexInTimeZone – UTC 2026 baseline", () => {
  it.each([
    ["2026-01-05", MON],
    ["2026-01-06", TUE],
    ["2026-01-07", WED],
    ["2026-01-08", THU],
    ["2026-01-09", FRI],
    ["2026-01-10", SAT],
    ["2026-01-11", SUN],
  ])("UTC noon %s → dayIndex=%i", (dateStr, expected) => {
    const instant = new Date(`${dateStr}T12:00:00.000Z`);
    expect(dayIndexInTimeZone("UTC", instant)).toBe(expected);
  });
});

describe("dateOnlyInTimeZone – UTC 2026 baseline", () => {
  it("returns YYYY-MM-DD format for UTC 2026", () => {
    const result = dateOnlyInTimeZone("UTC", new Date("2026-01-01T00:00:00.000Z"));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).toBe("2026-01-01");
  });

  it("UTC: 2026-01-05T21:30Z → '2026-01-05'", () => {
    expect(dateOnlyInTimeZone("UTC", new Date("2026-01-05T21:30:00.000Z"))).toBe("2026-01-05");
  });

  it("UTC: 2026-01-11T23:59Z → '2026-01-11'", () => {
    expect(dateOnlyInTimeZone("UTC", new Date("2026-01-11T23:59:59.999Z"))).toBe("2026-01-11");
  });
});

// ---------------------------------------------------------------------------
// Server process TZ independence
// ---------------------------------------------------------------------------
//
// These suites temporarily override process.env.TZ and verify that
// dayIndexInTimeZone / dateOnlyInTimeZone still return correct results
// because they use explicit Intl.DateTimeFormat timeZone options.
//
// NOTE: In Node.js, setting process.env.TZ after startup may not
// retroactively change Date behaviour on all versions; the point of this
// suite is that our implementation never depends on the server local TZ.

function assertMoscowJan5(label: string) {
  it(`[${label}] 2026-01-05T21:30Z → Moscow TUE (1)`, () => {
    const instant = new Date("2026-01-05T21:30:00.000Z");
    expect(dayIndexInTimeZone("Europe/Moscow", instant)).toBe(TUE);
    expect(dateOnlyInTimeZone("Europe/Moscow", instant)).toBe("2026-01-06");
  });

  it(`[${label}] 2026-01-11T21:30Z → Moscow MON (0)`, () => {
    const instant = new Date("2026-01-11T21:30:00.000Z");
    expect(dayIndexInTimeZone("Europe/Moscow", instant)).toBe(MON);
    expect(dateOnlyInTimeZone("Europe/Moscow", instant)).toBe("2026-01-12");
  });

  it(`[${label}] Amsterdam spring forward stable`, () => {
    const before = new Date("2026-03-29T00:30:00.000Z");
    const after = new Date("2026-03-29T01:30:00.000Z");
    expect(dayIndexInTimeZone("Europe/Amsterdam", before)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Amsterdam", after)).toBe(SUN);
  });

  it(`[${label}] Amsterdam fall back stable`, () => {
    const before = new Date("2026-10-25T00:30:00.000Z");
    const after = new Date("2026-10-25T01:30:00.000Z");
    expect(dayIndexInTimeZone("Europe/Amsterdam", before)).toBe(SUN);
    expect(dayIndexInTimeZone("Europe/Amsterdam", after)).toBe(SUN);
  });
}

describe("server TZ independence – Pacific/Kiritimati (UTC+14)", () => {
  beforeAll(() => {
    setProcessTZ("Pacific/Kiritimati");
  });
  afterAll(() => {
    restoreProcessTZ();
  });

  assertMoscowJan5("Pacific/Kiritimati");

  it("[Pacific/Kiritimati] UTC baseline Monday noon still MON (0)", () => {
    const instant = new Date("2026-01-05T12:00:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(MON);
  });
});

describe("server TZ independence – America/Los_Angeles (UTC-7/-8)", () => {
  beforeAll(() => {
    setProcessTZ("America/Los_Angeles");
  });
  afterAll(() => {
    restoreProcessTZ();
  });

  assertMoscowJan5("America/Los_Angeles");

  it("[America/Los_Angeles] UTC baseline Sunday noon still SUN (6)", () => {
    const instant = new Date("2026-01-11T12:00:00.000Z");
    expect(dayIndexInTimeZone("UTC", instant)).toBe(SUN);
  });
});

// ---------------------------------------------------------------------------
// normalizeTimeZone – already covered in fingerprint spec, spot-check 2026-relevant zones
// ---------------------------------------------------------------------------

describe("normalizeTimeZone – 2026 relevant zones", () => {
  it("Europe/Moscow passthrough", () => {
    expect(normalizeTimeZone("Europe/Moscow")).toBe("Europe/Moscow");
  });

  it("Europe/Amsterdam passthrough", () => {
    expect(normalizeTimeZone("Europe/Amsterdam")).toBe("Europe/Amsterdam");
  });

  it("Pacific/Kiritimati passthrough", () => {
    expect(normalizeTimeZone("Pacific/Kiritimati")).toBe("Pacific/Kiritimati");
  });

  it("America/Los_Angeles passthrough", () => {
    expect(normalizeTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
  });

  it("null → UTC", () => {
    expect(normalizeTimeZone(null)).toBe("UTC");
  });

  it("UTC passthrough", () => {
    expect(normalizeTimeZone("UTC")).toBe("UTC");
  });
});
