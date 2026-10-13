import type { Vehicle } from "@odjazd/api";
import { at, buildTimetable } from "@odjazd/engine/testing";
import type { LineId } from "@odjazd/model";
import { scheduleRealization } from "@odjazd/prediction";
import type { Timetable } from "@odjazd/timetable";
import { describe, expect, it } from "vitest";
import { makeExplorer } from "./explore.ts";
import type { LineLabel } from "./schema.ts";

const hash = "test-hash";

// Two platforms of one stop group ("Plac", ~110 m apart), a centre stop, a terminus and a bus-only stop.
const built = buildTimetable(
  [
    ["p1", 51.7, 19.46],
    ["p2", 51.701, 19.46],
    ["c1", 51.72, 19.46],
    ["d1", 51.73, 19.46],
    ["o1", 51.7, 19.47],
  ] as const,
  [
    {
      line: "tram:1",
      id: "tA",
      stops: [
        ["p1", "08:00"],
        ["c1", "08:10"],
      ],
    },
    {
      line: "tram:1",
      id: "tB",
      stops: [
        ["p1", "08:20"],
        ["c1", "08:30"],
      ],
    },
    {
      line: "tram:1",
      id: "tC",
      stops: [
        ["p2", "08:40"],
        ["c1", "08:50"],
        ["d1", "09:00"],
      ],
    },
    {
      line: "tram:1",
      id: "tD",
      stops: [
        ["c1", "08:05"],
        ["p2", "08:15"],
      ],
    },
    {
      line: "bus:2",
      id: "bA",
      stops: [
        ["p2", "08:30"],
        ["c1", "08:45"],
      ],
    },
    {
      line: "bus:2",
      id: "bB",
      stops: [
        ["o1", "09:00"],
        ["c1", "09:12"],
      ],
    },
  ],
);

const timetable: Timetable = {
  ...built,
  stops: { ...built.stops, names: ["Plac", "Plac", "Centrum", "Dworzec", "Osiedle"] },
  trips: {
    ...built.trips,
    headsigns: ["Centrum", "Centrum", "Dworzec", "Plac", "Centrum", "Centrum"],
    direction: Int8Array.of(0, 0, 0, 1, 0, 0),
  },
};

const label = (id: LineId): LineLabel => ({
  id,
  label: id.split("@")[0]?.split(":")[1] ?? "",
  mode: id.startsWith("tram") ? "tram" : "bus",
});

const explorer = () => makeExplorer(timetable, scheduleRealization(timetable), label);

const vehicleOn = (trip: string, stop: string, stopSequence: number, delay: number): Vehicle => ({
  id: `v-${trip}`,
  lineLabel: "1",
  mode: "tram",
  trip,
  stop,
  stopSequence,
  delay,
  lat: 51.7,
  lon: 19.46,
  at: at("08:00"),
});

const placGroup = (ex: ReturnType<typeof explorer>) => {
  const [hit] = ex.searchStops({ hash, text: "plac", limit: 1 });
  if (hit?._tag !== "Stop") throw new Error("no Plac stop group");
  return hit.stop.group;
};

describe("searchStops", () => {
  it("returns a Stop hit for a stop name", () => {
    const hits = explorer().searchStops({ hash, text: "plac", limit: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ _tag: "Stop", stop: { name: "Plac" } });
  });

  it("returns a Line hit carrying the top headsigns", () => {
    const hits = explorer().searchStops({ hash, text: "1", limit: 10 });
    expect(hits).toEqual([
      {
        _tag: "Line",
        line: { id: "tram:1@test", label: "1", mode: "tram" },
        // Centrum twice; Dworzec and Plac once each (ties in trip order).
        headsigns: ["Centrum", "Dworzec"],
      },
    ]);
  });
});

describe("allStops", () => {
  it("returns parallel arrays with one entry per stop group", () => {
    const stops = explorer().allStops();
    expect(stops.names).toEqual(["Plac", "Centrum", "Dworzec", "Osiedle"]);
    expect(stops.lat).toHaveLength(stops.names.length);
    expect(stops.lon).toHaveLength(stops.names.length);
    expect(stops.modes).toHaveLength(stops.names.length);
    expect(stops.lat[0]).toBeCloseTo(51.7005, 6);
    expect(stops.lon[0]).toBeCloseTo(19.46, 6);
  });

  it("encodes modes as bits: 1 for tram, 2 for other modes", () => {
    const { modes } = explorer().allStops();
    // Plac and Centrum: tram and bus. Dworzec: tram only. Osiedle: bus only.
    expect(modes).toEqual([3, 3, 1, 2]);
  });
});

describe("nearby", () => {
  it("returns only groups within the radius, nearest first", () => {
    const hits = explorer().nearby({
      hash,
      lat: 51.7005,
      lon: 19.46,
      radiusMeters: 300,
      limit: 10,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.stop.name).toBe("Plac");
    expect(hits[0]?.distanceMeters).toBeLessThan(300);
  });

  it("sorts wider results by distance", () => {
    const hits = explorer().nearby({
      hash,
      lat: 51.7005,
      lon: 19.46,
      radiusMeters: 5000,
      limit: 10,
    });
    expect(hits[0]?.stop.name).toBe("Plac");
    const distances = hits.map((hit) => hit.distanceMeters);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });
});

describe("stopBoard", () => {
  const query = (ex: ReturnType<typeof explorer>, horizonMinutes = 60, limit = 10) =>
    ex.stopBoard({ hash, group: placGroup(ex), at: at("07:55"), horizonMinutes, limit });

  it("lists departures from all platforms of the group with platform indexes", () => {
    const board = query(explorer());
    expect(board.platforms.map((p) => p.platform)).toEqual([0, 1]);
    expect(board.platforms[1]).toMatchObject({ lat: 51.701, lon: 19.46 });

    // tD leaves Plac's second platform as its last stop, so it is not a departure.
    expect(
      board.departures.map((d) => ({ trip: d.trip, platform: d.platform, departAt: d.departAt })),
    ).toEqual([
      { trip: "tA", platform: 0, departAt: at("08:00") },
      { trip: "tB", platform: 0, departAt: at("08:20") },
      { trip: "bA", platform: 1, departAt: at("08:30") },
      { trip: "tC", platform: 1, departAt: at("08:40") },
    ]);
    for (const departure of board.departures) {
      expect(board.platforms[departure.platform]).toBeDefined();
      expect(departure.stop).toBe("Plac");
      expect(departure.scheduledAt).toBe(departure.departAt);
      expect(departure).not.toHaveProperty("delay");
    }
  });

  it("applies a live delay to the matching trip, and only that trip", () => {
    const ex = explorer();
    ex.setLive([vehicleOn("tA", "p1", 1, 120)], at("08:00"));
    const board = query(ex);

    const tA = board.departures.find((d) => d.trip === "tA");
    expect(tA).toMatchObject({ delay: 120 });
    expect(tA?.departAt).toBe((tA?.scheduledAt ?? 0) + 120);

    const tB = board.departures.find((d) => d.trip === "tB");
    expect(tB).toBeDefined();
    expect(tB).not.toHaveProperty("delay");
    expect(tB?.departAt).toBe(tB?.scheduledAt);
  });
});

describe("lineRoute", () => {
  it("picks the most frequent stop pattern per direction", () => {
    const route = explorer().lineRoute({ hash, line: "tram:1@test" });
    expect(route).toBeDefined();
    expect(route?.line).toEqual({ id: "tram:1@test", label: "1", mode: "tram" });
    expect(route?.directions.map((d) => d.headsign)).toEqual(["Centrum", "Plac"]);

    const [forward, back] = route?.directions ?? [];
    // Direction 0: tA and tB share Plac -> Centrum; the Plac -> Centrum -> Dworzec trip is rarer.
    expect(forward?.trips).toBe(2);
    expect(forward?.stops.map((s) => s.name)).toEqual(["Plac", "Centrum"]);
    expect(forward?.stops[0]?.group).toBe(placGroup(explorer()));
    // Direction 1: a single trip Centrum -> Plac.
    expect(back?.trips).toBe(1);
    expect(back?.stops.map((s) => s.name)).toEqual(["Centrum", "Plac"]);
  });

  it("returns undefined for an unknown line", () => {
    expect(explorer().lineRoute({ hash, line: "tram:99@test" })).toBeUndefined();
  });
});

describe("trip", () => {
  const tripAt = (ex: ReturnType<typeof explorer>, trip: string, now = "08:05") =>
    ex.trip({ hash, trip, at: at(now) });

  it("returns stops with scheduled and expected times when nothing is live", () => {
    const result = tripAt(explorer(), "tA");
    expect(result).toBeDefined();
    expect(result?.headsign).toBe("Centrum");
    expect(result?.stops.map((s) => [s.name, s.sequence, s.scheduledAt, s.expectedAt])).toEqual([
      ["Plac", 0, at("08:00"), at("08:00")],
      ["Centrum", 1, at("08:10"), at("08:10")],
    ]);
    expect(result).not.toHaveProperty("delay");
    expect(result).not.toHaveProperty("fromSequence");
  });

  it("reports the delay and the sequence it applies from when live", () => {
    const ex = explorer();
    ex.setLive([vehicleOn("tA", "p1", 1, 120)], at("08:00"));
    const trip = tripAt(ex, "tA");
    expect(trip?.delay).toBe(120);
    expect(trip?.fromSequence).toBe(0);
    expect(trip?.stops.map((s) => s.expectedAt - s.scheduledAt)).toEqual([120, 120]);
  });

  it("applies the delay only from the vehicle's stop onward", () => {
    const ex = explorer();
    ex.setLive([vehicleOn("tA", "c1", 2, 60)], at("08:05"));
    const trip = tripAt(ex, "tA");
    expect(trip?.fromSequence).toBe(1);
    expect(trip?.stops.map((s) => s.expectedAt - s.scheduledAt)).toEqual([0, 60]);
  });

  it("returns undefined for an unknown trip id or a time far from its service", () => {
    expect(tripAt(explorer(), "nope")).toBeUndefined();
    expect(tripAt(explorer(), "tA", "20:00")).toBeUndefined();
  });
});
