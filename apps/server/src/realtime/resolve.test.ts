import type { Vehicle } from "@odjazd/api";
import { buildTimetable } from "@odjazd/engine/testing";
import type { RawFeed, RawVehicle } from "@odjazd/ingest";
import { describe, expect, it } from "vitest";
import { diffVehicles, makeResolver, resolveVehicles } from "./resolve.ts";

const timetable = buildTimetable(
  [
    ["s1", 51.7, 19.46],
    ["s2", 51.71, 19.46],
  ],
  [
    {
      line: "tram:10",
      id: "t1",
      stops: [
        ["s1", "08:00"],
        ["s2", "08:05"],
      ],
    },
  ],
);
const resolver = makeResolver(timetable);
const now = 1_000_000;

const raw = (overrides: Partial<RawVehicle>): RawVehicle => ({
  id: "v1",
  label: "1234",
  tripId: "t1",
  routeId: "10",
  lat: 51.7,
  lon: 19.46,
  bearing: undefined,
  speed: undefined,
  stopId: "s2",
  stopSequence: 2,
  status: "in_transit",
  timestamp: now - 10,
  ...overrides,
});
const feed = (...entities: Array<RawVehicle>): RawFeed<RawVehicle> => ({
  timestamp: now,
  entities,
});

describe("resolveVehicles", () => {
  it("resolves trip, line, stop and the delay toward the next stop", () => {
    const updates = {
      timestamp: now,
      entities: [
        {
          tripId: "t1",
          vehicleId: "v1",
          delay: undefined,
          timestamp: now,
          stops: [
            { stopSequence: 1, stopId: "s1", arrivalDelay: 30, departureDelay: undefined },
            { stopSequence: 2, stopId: "s2", arrivalDelay: 90, departureDelay: undefined },
          ],
        },
      ],
    };
    const [vehicle] = resolveVehicles(resolver, feed(raw({})), updates, new Map(), now);
    expect(vehicle).toMatchObject({
      line: "tram:10@test",
      lineLabel: "10",
      mode: "tram",
      stopName: "s2",
      delay: 90,
    });
  });

  it("falls back to the route label for unknown trips and drops stale fixes", () => {
    const vehicles = resolveVehicles(
      resolver,
      feed(raw({ tripId: "gone" }), raw({ id: "v2", timestamp: now - 3600 })),
      undefined,
      new Map(),
      now,
    );
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toMatchObject({ line: "tram:10@test", trip: "gone" });
  });

  it("derives bearing from movement", () => {
    const [first] = resolveVehicles(resolver, feed(raw({})), undefined, new Map(), now);
    if (first === undefined) throw new Error("no vehicle");
    const [moved] = resolveVehicles(
      resolver,
      feed(raw({ lat: 51.701, timestamp: now })),
      undefined,
      new Map([["v1", first]]),
      now,
    );
    expect(moved?.bearing).toBe(0);
  });
});

describe("diffVehicles", () => {
  it("reports changed, new and vanished vehicles", () => {
    const base: Vehicle = { id: "a", lineLabel: "1", mode: "tram", lat: 1, lon: 1, at: 1 };
    const previous = new Map([
      ["a", base],
      ["b", { ...base, id: "b" }],
    ]);
    const { upserts, removed } = diffVehicles(previous, [base, { ...base, id: "c" }]);
    expect(upserts.map((v) => v.id)).toEqual(["c"]);
    expect(removed).toEqual(["b"]);
  });
});
