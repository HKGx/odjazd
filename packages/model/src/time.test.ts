import { describe, expect, it } from "vitest";
import {
  gtfsTimeToEpoch,
  localToEpoch,
  parseGtfsDate,
  parseGtfsTime,
  ServiceDate,
  serviceDayAnchor,
  TimeZone,
  toZoned,
  type EpochSeconds,
} from "./time.ts";

const warsaw = TimeZone.make("Europe/Warsaw");
const date = (iso: string) => ServiceDate.make(iso);
const utc = (iso: string) => (Date.parse(iso) / 1000) as EpochSeconds;

/** Absolute instant of GTFS time `time` on service day `day` in Warsaw. */
const at = (day: string, time: string) => {
  const offset = parseGtfsTime(time);
  if (offset === undefined) throw new Error(`bad time ${time}`);
  return gtfsTimeToEpoch(serviceDayAnchor(date(day), warsaw), offset);
};
const wallClock = (epoch: EpochSeconds) => toZoned(epoch, warsaw).toPlainDateTime().toString();

describe("parseGtfsTime", () => {
  it("parses one- and two-digit hours", () => {
    expect(parseGtfsTime("8:05:09")).toBe(8 * 3600 + 5 * 60 + 9);
    expect(parseGtfsTime("08:05:09")).toBe(8 * 3600 + 5 * 60 + 9);
    expect(parseGtfsTime("00:00:00")).toBe(0);
  });

  it("accepts hours past 24", () => {
    expect(parseGtfsTime("25:30:00")).toBe(25.5 * 3600);
    expect(parseGtfsTime("100:00:00")).toBe(100 * 3600);
  });

  it.each([
    "",
    "8:5:09",
    "08:05",
    "08-05-09",
    "08:60:00",
    "08:00:60",
    "ab:00:00",
    " 8:00:00",
    "1000:00:00",
  ])("rejects %j", (text) => expect(parseGtfsTime(text)).toBeUndefined());
});

describe("parseGtfsDate", () => {
  it("converts to ISO form", () => expect(parseGtfsDate("20261013")).toBe("2026-10-13"));

  it.each(["2026101", "20261313", "20260230", "2026-10-13", "abcdefgh"])("rejects %j", (text) =>
    expect(parseGtfsDate(text)).toBeUndefined(),
  );
});

describe("schemas", () => {
  it("reject invalid zones and dates", () => {
    expect(() => TimeZone.make("Europe/Nowhere")).toThrow();
    expect(() => ServiceDate.make("2026-02-29")).toThrow();
    expect(ServiceDate.make("2028-02-29")).toBe("2028-02-29");
  });
});

describe("GTFS time → epoch (Europe/Warsaw)", () => {
  it("ordinary summer-time day", () => {
    expect(at("2026-10-13", "08:15:00")).toBe(utc("2026-10-13T06:15:00Z"));
    expect(wallClock(at("2026-10-13", "08:15:00"))).toBe("2026-10-13T08:15:00");
  });

  it("ordinary winter-time day", () => {
    expect(at("2026-01-15", "08:15:00")).toBe(utc("2026-01-15T07:15:00Z"));
  });

  it("times past 24:00 land on the next calendar day", () => {
    expect(wallClock(at("2026-10-13", "24:00:00"))).toBe("2026-10-14T00:00:00");
    expect(wallClock(at("2026-10-13", "25:30:00"))).toBe("2026-10-14T01:30:00");
  });

  it("25:00 on one day is 01:00 on the next (outside DST changes)", () => {
    expect(at("2026-10-12", "25:00:00")).toBe(at("2026-10-13", "01:00:00"));
  });

  describe("spring forward, 2026-03-29 (02:00 CET → 03:00 CEST)", () => {
    it("daytime departures keep their wall-clock time", () => {
      expect(wallClock(at("2026-03-29", "08:00:00"))).toBe("2026-03-29T08:00:00");
      expect(at("2026-03-29", "08:00:00")).toBe(utc("2026-03-29T06:00:00Z"));
    });

    it("anchor is noon minus 12 h, one hour before local midnight", () => {
      expect(serviceDayAnchor(date("2026-03-29"), warsaw)).toBe(utc("2026-03-28T22:00:00Z"));
      expect(wallClock(at("2026-03-29", "00:30:00"))).toBe("2026-03-28T23:30:00");
      expect(wallClock(at("2026-03-29", "03:00:00"))).toBe("2026-03-29T03:00:00");
    });

    it("a trip crossing the change from the previous service day keeps its real duration", () => {
      const depart = at("2026-03-28", "25:50:00");
      const arrive = at("2026-03-28", "26:10:00");
      expect(arrive - depart).toBe(20 * 60);
      expect(wallClock(depart)).toBe("2026-03-29T01:50:00");
      expect(wallClock(arrive)).toBe("2026-03-29T03:10:00");
    });
  });

  describe("fall back, 2026-10-25 (03:00 CEST → 02:00 CET)", () => {
    it("daytime departures keep their wall-clock time", () => {
      expect(wallClock(at("2026-10-25", "08:00:00"))).toBe("2026-10-25T08:00:00");
      expect(at("2026-10-25", "08:00:00")).toBe(utc("2026-10-25T07:00:00Z"));
    });

    it("anchor is noon minus 12 h, one hour after local midnight", () => {
      expect(serviceDayAnchor(date("2026-10-25"), warsaw)).toBe(utc("2026-10-24T23:00:00Z"));
    });

    it("the repeated hour maps to two distinct instants", () => {
      const first = at("2026-10-25", "01:00:00");
      const second = at("2026-10-25", "02:00:00");
      expect(second - first).toBe(3600);
      expect(wallClock(first)).toBe("2026-10-25T02:00:00");
      expect(wallClock(second)).toBe("2026-10-25T02:00:00");
    });

    it("a trip crossing the change from the previous service day keeps its real duration", () => {
      const depart = at("2026-10-24", "26:30:00");
      const arrive = at("2026-10-24", "27:30:00");
      expect(arrive - depart).toBe(3600);
      expect(depart).toBe(utc("2026-10-25T00:30:00Z"));
      expect(wallClock(depart)).toBe("2026-10-25T02:30:00");
      expect(wallClock(arrive)).toBe("2026-10-25T02:30:00");
    });
  });
});

describe("localToEpoch", () => {
  it("interprets wall-clock time in the zone", () => {
    expect(localToEpoch(date("2026-10-13"), "08:15", warsaw)).toBe(utc("2026-10-13T06:15:00Z"));
    expect(localToEpoch(date("2026-01-15"), "08:15:30", warsaw)).toBe(utc("2026-01-15T07:15:30Z"));
  });

  it("resolves DST gaps forward and repeats to the first occurrence", () => {
    expect(localToEpoch(date("2026-03-29"), "02:30", warsaw)).toBe(utc("2026-03-29T01:30:00Z"));
    expect(localToEpoch(date("2026-10-25"), "02:30", warsaw)).toBe(utc("2026-10-25T00:30:00Z"));
  });
});
