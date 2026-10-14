import type { AgencySlug, CityId, LineId, ServiceDate, TimeZone } from "@odjazd/model";
import { describe, expect, it } from "vitest";
import { decodeTimetable, encodeTimetable, TimetableFormatError } from "./binary.ts";
import type { Timetable } from "./timetable.ts";

const sample: Timetable = {
  cityId: "pl-test" as CityId,
  timeZone: "Europe/Warsaw" as TimeZone,
  feedVersion: "v1",
  days: { first: "2026-10-13" as ServiceDate, count: 2, anchors: Float64Array.of(1, 2) },
  agencies: [{ slug: "test" as AgencySlug, name: "Test" }],
  lines: [{ id: "tram:12@test" as LineId, mode: "tram", agency: 0 }],
  stops: {
    count: 3,
    names: ["Łódź Fabryczna", "B", "C"],
    feedIds: ["s1", "s2", "s3"],
    lat: Float64Array.of(51.7, 51.71, 51.72),
    lon: Float64Array.of(19.4, 19.41, 19.42),
  },
  services: { count: 1, activeDays: Uint8Array.of(3), bytesPerService: 1 },
  trips: {
    count: 1,
    line: Uint32Array.of(0),
    service: Uint32Array.of(0),
    firstStopTime: Uint32Array.of(0, 3),
    direction: Int8Array.of(-1),
    headsigns: ["C"],
    feedIds: ["t1"],
  },
  stopTimes: {
    count: 3,
    stop: Uint32Array.of(0, 1, 2),
    arrival: Int32Array.of(28800, 29100, 91800),
    departure: Int32Array.of(28800, 29160, 91800),
    flags: Uint8Array.of(0, 4, 0),
  },
};

describe("binary timetable", () => {
  it("round-trips every field", () => {
    expect(decodeTimetable(encodeTimetable(sample))).toEqual(sample);
  });

  it("maps undefined feedVersion through", () => {
    const decoded = decodeTimetable(encodeTimetable({ ...sample, feedVersion: undefined }));
    expect(decoded.feedVersion).toBeUndefined();
  });

  it("returns views into the buffer, not copies", () => {
    const bytes = encodeTimetable(sample);
    const decoded = decodeTimetable(bytes);
    expect(decoded.stopTimes.arrival.buffer).toBe(bytes.buffer);
  });

  it("copies unaligned input once instead of failing", () => {
    const bytes = encodeTimetable(sample);
    const shifted = new Uint8Array(bytes.length + 1);
    shifted.set(bytes, 1);
    expect(decodeTimetable(shifted.subarray(1))).toEqual(sample);
  });

  it("round-trips shapes when the timetable has them", () => {
    const withShapes: Timetable = {
      ...sample,
      shapes: {
        count: 1,
        firstPoint: Uint32Array.of(0, 3),
        lat: Int32Array.of(51_770_000, 51_775_000, 51_780_000),
        lon: Int32Array.of(19_450_000, 19_452_000, 19_460_000),
        ofTrip: Int32Array.from({ length: sample.trips.count }, (_, i) => (i === 0 ? 0 : -1)),
      },
    };
    expect(decodeTimetable(encodeTimetable(withShapes))).toEqual(withShapes);
    expect(decodeTimetable(encodeTimetable(sample)).shapes).toBeUndefined();
  });

  it("still reads version 1 files (no shapes)", () => {
    const old = encodeTimetable(sample).slice();
    new DataView(old.buffer).setUint32(4, 1, true);
    expect(decodeTimetable(old)).toEqual(sample);
  });

  it("round-trips footpaths when the timetable has them", () => {
    // Stop 0 <-> stop 1 are 400 m apart on foot; stop 2 has no footpath.
    const withFootpaths: Timetable = {
      ...sample,
      footpaths: {
        first: Uint32Array.of(0, 1, 2, 2),
        to: Uint32Array.of(1, 0),
        meters: Uint32Array.of(400, 400),
      },
    };
    const decoded = decodeTimetable(encodeTimetable(withFootpaths));
    expect(decoded).toEqual(withFootpaths);
    expect(decoded.footpaths?.meters.length).toBe(2);
  });

  it("decodes without footpaths as undefined", () => {
    expect(decodeTimetable(encodeTimetable(sample)).footpaths).toBeUndefined();
  });

  it("still reads version 2 files (no footpaths)", () => {
    const old = encodeTimetable(sample).slice();
    new DataView(old.buffer).setUint32(4, 2, true);
    const decoded = decodeTimetable(old);
    expect(decoded).toEqual(sample);
    expect(decoded.footpaths).toBeUndefined();
  });

  it("rejects foreign, truncated and future-version files", () => {
    const bytes = encodeTimetable(sample);
    expect(() => decodeTimetable(new TextEncoder().encode("PK\u0003\u0004 not ours"))).toThrow(
      TimetableFormatError,
    );
    expect(() => decodeTimetable(bytes.slice(0, bytes.length - 8))).toThrow("out of bounds");
    const future = bytes.slice();
    new DataView(future.buffer).setUint32(4, 99, true);
    expect(() => decodeTimetable(future)).toThrow("unsupported format version 99");
  });
});
