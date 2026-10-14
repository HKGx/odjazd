import type { EpochSeconds } from "@odjazd/model";
import { scheduleRealization, straightLineWalking, type Realization } from "@odjazd/prediction";
import { StopTimeFlag, type Timetable } from "@odjazd/timetable";
import { describe, expect, it } from "vitest";
import { buildPlanIndex, plan, planOnce, type Journey, type PlanOptions } from "./plan.ts";
import { at, buildTimetable } from "./test-timetable.ts";

// Stops on one meridian; neighbouring areas are ~2.2 km apart.
const A = ["a", 51.7, 19.46] as const;
const X = ["x", 51.72, 19.46] as const;
const B = ["b", 51.74, 19.46] as const;
const pointA = { lat: 51.7, lon: 19.46 };
const pointB = { lat: 51.74, lon: 19.46 };

const planOptions = (timetable: Timetable, overrides: Partial<PlanOptions> = {}): PlanOptions => ({
  realization: scheduleRealization(timetable),
  walking: straightLineWalking(),
  at: at("08:00"),
  transferBufferSec: 60,
  ...overrides,
});

/** Schedule, but the given stop times run `seconds` late (arrivals and departures alike). */
const delayStopTimes = (
  timetable: Timetable,
  stopTimes: ReadonlyArray<number>,
  seconds: number,
): Realization => {
  const base = scheduleRealization(timetable);
  return {
    arrival: (day, st) =>
      (base.arrival(day, st) + (stopTimes.includes(st) ? seconds : 0)) as EpochSeconds,
    departure: (day, st) =>
      (base.departure(day, st) + (stopTimes.includes(st) ? seconds : 0)) as EpochSeconds,
  };
};

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const dominates = (o: Journey, j: Journey) =>
  o.departAt >= j.departAt &&
  o.arriveAt <= j.arriveAt &&
  o.rides <= j.rides &&
  (o.departAt > j.departAt || o.arriveAt < j.arriveAt || o.rides < j.rides);

describe("buildPlanIndex", () => {
  // Stops a, n (200 m north of a), f (~1 km north of a), b.
  const stops = [
    ["a", 51.7, 19.46],
    ["n", 51.7018, 19.46],
    ["f", 51.709, 19.46],
    ["b", 51.74, 19.46],
  ] as const;
  const timetable = buildTimetable(stops, [
    {
      line: "tram:1",
      id: "t1",
      stops: [
        ["a", "08:00"],
        ["b", "08:10"],
      ],
    },
    {
      line: "tram:1",
      id: "t2",
      stops: [
        ["a", "08:05"],
        ["b", "08:15"],
      ],
    },
    {
      // Departs after t1 but arrives before it: overtakes, so it needs its own pattern.
      line: "tram:1",
      id: "t3",
      stops: [
        ["a", "08:02"],
        ["b", "08:07"],
      ],
    },
  ]);
  const index = buildPlanIndex(timetable);

  it("shares one pattern between same-line trips with the same stops that do not overtake", () => {
    expect(index.patterns.map((pattern) => Array.from(pattern.trips))).toEqual([[0, 1], [2]]);
    expect(index.patterns.every((pattern) => pattern.line === 0)).toBe(true);
  });

  it("lists (pattern, position) pairs for every stop", () => {
    // Stop 0 (a) is position 0 of both patterns; stop 3 (b) is position 1 of both.
    expect(Array.from(index.patternsOfStop[0] ?? [])).toEqual([0, 0, 1, 0]);
    expect(Array.from(index.patternsOfStop[3] ?? [])).toEqual([0, 1, 1, 1]);
    expect(Array.from(index.patternsOfStop[1] ?? [])).toEqual([]);
  });

  it("links stops within 400 m as neighbours, but not stops 1 km away", () => {
    expect(Array.from(index.neighbors[0] ?? [])).toContain(1);
    expect(Array.from(index.neighbors[1] ?? [])).toContain(0);
    expect(Array.from(index.neighbors[0] ?? [])).not.toContain(2);
  });
});

describe("buildPlanIndex with footpaths", () => {
  // p and q are 500 m apart: beyond the straight-line 400 m rule, but listed as a footpath.
  // c and d are 50 m apart and not listed, so they must not become neighbours.
  const stops = [
    ["p", 51.7, 19.46],
    ["q", 51.7045, 19.46],
    ["c", 51.72, 19.46],
    ["d", 51.72045, 19.46],
  ] as const;
  const timetable = buildTimetable(stops, [
    {
      line: "tram:1",
      id: "t1",
      stops: [
        ["p", "08:00"],
        ["c", "08:10"],
      ],
    },
  ]);
  const withFootpaths: Timetable = {
    ...timetable,
    footpaths: {
      first: Uint32Array.of(0, 1, 2, 2, 2),
      to: Uint32Array.of(1, 0),
      // Deliberately not the straight-line 500 m, so the test shows the listed value is used.
      meters: Uint32Array.of(777, 777),
    },
  };

  it("uses exactly the listed neighbours and meters", () => {
    const index = buildPlanIndex(withFootpaths);
    expect(Array.from(index.neighbors[0] ?? [])).toEqual([1]);
    expect(Array.from(index.neighborMeters[0] ?? [])).toEqual([777]);
    expect(Array.from(index.neighbors[1] ?? [])).toEqual([0]);
    expect(Array.from(index.neighborMeters[1] ?? [])).toEqual([777]);
    expect(Array.from(index.neighbors[2] ?? [])).toEqual([]);
    expect(Array.from(index.neighbors[3] ?? [])).toEqual([]);
  });

  it("without footpaths, the same stops use the straight-line rule instead", () => {
    const index = buildPlanIndex(timetable);
    expect(Array.from(index.neighbors[0] ?? [])).toEqual([]);
    expect(Array.from(index.neighbors[2] ?? [])).toEqual([3]);
  });

  it("walks a transfer for meters / speed seconds", () => {
    // s2 and s3 are 400 m apart on foot (listed), so the change walk takes 400 / 1.25 m/s.
    const transferStops = [
      ["s1", 51.7, 19.46],
      ["s2", 51.72, 19.46],
      ["s3", 51.7225, 19.46],
      ["d", 51.74, 19.46],
    ] as const;
    const base = buildTimetable(transferStops, [
      {
        line: "tram:1",
        id: "t1",
        stops: [
          ["s1", "08:00"],
          ["s2", "08:10"],
        ],
      },
      {
        line: "tram:2",
        id: "t2",
        stops: [
          ["s3", "08:20"],
          ["d", "08:30"],
        ],
      },
    ]);
    const linked: Timetable = {
      ...base,
      footpaths: {
        first: Uint32Array.of(0, 0, 1, 2, 2),
        to: Uint32Array.of(2, 1),
        meters: Uint32Array.of(400, 400),
      },
    };
    const walking = straightLineWalking();
    const journeys = planOnce(
      linked,
      buildPlanIndex(linked),
      { lat: 51.7, lon: 19.46 },
      { lat: 51.74, lon: 19.46 },
      planOptions(linked, { transferBufferSec: 0, walking }),
    );

    const [journey] = journeys;
    expect(journey?.rides).toBe(2);
    const transfer = journey?.legs.find((leg) => leg.kind === "walk" && leg.fromStop !== undefined);
    expect(transfer).toEqual({
      kind: "walk",
      fromStop: 1,
      toStop: 2,
      departAt: at("08:10"),
      arriveAt: at("08:10") + walking.secondsAlong(400),
    });
    expect(walking.secondsAlong(400)).toBe(320);
  });
});

describe("planOnce", () => {
  it("finds a direct ride with no walk legs when access and egress are zero", () => {
    const timetable = buildTimetable(
      [A, B],
      [
        {
          line: "tram:1",
          id: "t1",
          stops: [
            ["a", "08:10"],
            ["b", "08:20"],
          ],
        },
      ],
    );
    const journeys = planOnce(
      timetable,
      buildPlanIndex(timetable),
      pointA,
      pointB,
      planOptions(timetable),
    );

    expect(journeys).toHaveLength(1);
    const [journey] = journeys;
    expect(journey?.rides).toBe(1);
    expect(journey?.legs).toEqual([
      {
        kind: "ride",
        trip: 0,
        day: 0,
        line: 0,
        board: 0,
        alight: 1,
        departAt: at("08:10"),
        arriveAt: at("08:20"),
      },
    ]);
    expect(journey?.departAt).toBe(at("08:10"));
    expect(journey?.arriveAt).toBe(at("08:20"));
  });

  it("respects the transfer buffer at the interchange", () => {
    const timetable = buildTimetable(
      [A, X, B],
      [
        {
          line: "tram:1",
          id: "t1",
          stops: [
            ["a", "08:00"],
            ["x", "08:10"],
          ],
        },
        {
          // Leaves X 60 s after arrival: below the 120 s buffer, so not taken.
          line: "tram:2",
          id: "too-soon",
          stops: [
            ["x", "08:11"],
            ["b", "08:25"],
          ],
        },
        {
          line: "tram:2",
          id: "connection",
          stops: [
            ["x", "08:15"],
            ["b", "08:30"],
          ],
        },
      ],
    );
    const journeys = planOnce(
      timetable,
      buildPlanIndex(timetable),
      pointA,
      pointB,
      planOptions(timetable, { transferBufferSec: 120 }),
    );

    expect(journeys).toHaveLength(1);
    const [journey] = journeys;
    expect(journey?.rides).toBe(2);
    const rides = journey?.legs.filter((leg) => leg.kind === "ride") ?? [];
    expect(rides.map((leg) => leg.kind === "ride" && leg.trip)).toEqual([0, 2]);
    expect(rides[1]?.departAt).toBe(at("08:15"));
    expect(journey?.arriveAt).toBe(at("08:30"));
  });

  it("returns a slow direct ride and a faster transfer ride, in that order", () => {
    const timetable = buildTimetable(
      [A, X, B],
      [
        {
          line: "tram:1",
          id: "direct",
          stops: [
            ["a", "08:00"],
            ["b", "08:50"],
          ],
        },
        {
          line: "bus:2",
          id: "first",
          stops: [
            ["a", "08:05"],
            ["x", "08:15"],
          ],
        },
        {
          line: "bus:3",
          id: "second",
          stops: [
            ["x", "08:20"],
            ["b", "08:35"],
          ],
        },
      ],
    );
    const journeys = planOnce(
      timetable,
      buildPlanIndex(timetable),
      pointA,
      pointB,
      planOptions(timetable),
    );

    expect(journeys.map((journey) => [journey.rides, journey.arriveAt])).toEqual([
      [1, at("08:50")],
      [2, at("08:35")],
    ]);
  });

  it("connects two lines through a footpath between nearby stops", () => {
    // X1 and X2 are ~150 m apart: about 156 s on foot.
    const timetable = buildTimetable(
      [A, ["x1", 51.72, 19.46], ["x2", 51.72135, 19.46], B],
      [
        {
          line: "tram:1",
          id: "t1",
          stops: [
            ["a", "08:00"],
            ["x1", "08:10"],
          ],
        },
        {
          line: "tram:2",
          id: "t2",
          stops: [
            ["x2", "08:15"],
            ["b", "08:30"],
          ],
        },
      ],
    );
    const journeys = planOnce(
      timetable,
      buildPlanIndex(timetable),
      pointA,
      pointB,
      planOptions(timetable),
    );

    expect(journeys).toHaveLength(1);
    const legs = journeys[0]?.legs ?? [];
    expect(legs.map((leg) => leg.kind)).toEqual(["ride", "walk", "ride"]);
    expect(legs[1]).toMatchObject({ kind: "walk", fromStop: 1, toStop: 2 });
  });

  it("skips avoided lines and uses the alternative", () => {
    const timetable = buildTimetable(
      [A, X, B],
      [
        {
          // Line index 0: the only direct option.
          line: "tram:1",
          id: "direct",
          stops: [
            ["a", "08:10"],
            ["b", "08:20"],
          ],
        },
        {
          line: "bus:2",
          id: "first",
          stops: [
            ["a", "08:05"],
            ["x", "08:12"],
          ],
        },
        {
          line: "bus:3",
          id: "second",
          stops: [
            ["x", "08:14"],
            ["b", "08:25"],
          ],
        },
      ],
    );
    const index = buildPlanIndex(timetable);

    const unrestricted = planOnce(timetable, index, pointA, pointB, planOptions(timetable));
    expect(unrestricted[0]?.rides).toBe(1);

    const journeys = planOnce(
      timetable,
      index,
      pointA,
      pointB,
      planOptions(timetable, { avoidLines: new Set([0]) }),
    );
    expect(journeys).toHaveLength(1);
    expect(journeys[0]?.rides).toBe(2);
    expect(journeys[0]?.arriveAt).toBe(at("08:25"));
    expect(journeys[0]?.legs.some((leg) => leg.kind === "ride" && leg.line === 0)).toBe(false);
  });

  it("returns nothing when the only line is avoided", () => {
    const timetable = buildTimetable(
      [A, B],
      [
        {
          line: "tram:1",
          id: "direct",
          stops: [
            ["a", "08:10"],
            ["b", "08:20"],
          ],
        },
      ],
    );
    const journeys = planOnce(
      timetable,
      buildPlanIndex(timetable),
      pointA,
      pointB,
      planOptions(timetable, { avoidLines: new Set([0]) }),
    );
    expect(journeys).toEqual([]);
  });

  it("does not board a trip whose stop at the origin is noPickup", () => {
    const timetable = buildTimetable(
      [A, B],
      [
        {
          // Earlier, and would arrive first, but nobody may board here.
          line: "tram:1",
          id: "no-pickup",
          stops: [
            ["a", "08:05", StopTimeFlag.noPickup],
            ["b", "08:12"],
          ],
        },
        {
          line: "tram:1",
          id: "ok",
          stops: [
            ["a", "08:10"],
            ["b", "08:20"],
          ],
        },
      ],
    );
    const journeys = planOnce(
      timetable,
      buildPlanIndex(timetable),
      pointA,
      pointB,
      planOptions(timetable),
    );

    expect(journeys).toHaveLength(1);
    expect(journeys[0]?.departAt).toBe(at("08:10"));
    expect(journeys[0]?.arriveAt).toBe(at("08:20"));
  });

  // Trips with different pickup/drop-off flags must not share a pattern.
  it("does not alight at a stop where the trip is noDropOff, but uses a later trip", () => {
    const timetable = buildTimetable(
      [A, B],
      [
        {
          line: "tram:1",
          id: "no-drop-off",
          stops: [
            ["a", "08:05"],
            ["b", "08:12", StopTimeFlag.noDropOff],
          ],
        },
        {
          line: "tram:1",
          id: "ok",
          stops: [
            ["a", "08:10"],
            ["b", "08:20"],
          ],
        },
      ],
    );
    const journeys = planOnce(
      timetable,
      buildPlanIndex(timetable),
      pointA,
      pointB,
      planOptions(timetable),
    );

    expect(journeys).toHaveLength(1);
    expect(journeys[0]?.departAt).toBe(at("08:10"));
    expect(journeys[0]?.arriveAt).toBe(at("08:20"));
  });

  it("uses realized times: a 5 min late departure moves the ride", () => {
    const timetable = buildTimetable(
      [A, B],
      [
        {
          line: "tram:1",
          id: "t1",
          stops: [
            ["a", "08:10"],
            ["b", "08:20"],
          ],
        },
      ],
    );
    const journeys = planOnce(timetable, buildPlanIndex(timetable), pointA, pointB, {
      ...planOptions(timetable),
      realization: delayStopTimes(timetable, [0, 1], 300),
    });

    expect(journeys).toHaveLength(1);
    expect(journeys[0]?.departAt).toBe(at("08:15"));
    expect(journeys[0]?.arriveAt).toBe(at("08:25"));
    expect(journeys[0]?.legs[0]).toMatchObject({
      kind: "ride",
      departAt: at("08:15"),
      arriveAt: at("08:25"),
    });
  });

  it("boards an earlier trip when the first choice is delayed past it", () => {
    const timetable = buildTimetable(
      [A, B],
      [
        {
          line: "tram:1",
          id: "delayed",
          stops: [
            ["a", "08:10"],
            ["b", "08:20"],
          ],
        },
        {
          line: "tram:1",
          id: "on-time",
          stops: [
            ["a", "08:14"],
            ["b", "08:24"],
          ],
        },
      ],
    );
    const journeys = planOnce(timetable, buildPlanIndex(timetable), pointA, pointB, {
      ...planOptions(timetable),
      realization: delayStopTimes(timetable, [0, 1], 300),
    });

    expect(journeys).toHaveLength(1);
    expect(journeys[0]?.legs[0]).toMatchObject({
      kind: "ride",
      trip: 1,
      departAt: at("08:14"),
      arriveAt: at("08:24"),
    });
  });
});

describe("plan", () => {
  // Trips from A every 10 minutes, 15 minutes to B (~4.4 km away: walking is too long).
  const frequent = buildTimetable(
    [A, B],
    Array.from({ length: 7 }, (_, i) => ({
      line: "tram:1",
      id: `t${i}`,
      stops: [
        ["a", hhmm(8 * 60 + i * 10)],
        ["b", hhmm(8 * 60 + i * 10 + 15)],
      ] as const,
    })),
  );

  it("returns several sorted, distinct, non-dominated journeys", () => {
    const result = plan(frequent, buildPlanIndex(frequent), pointA, pointB, {
      ...planOptions(frequent),
      count: 3,
    });

    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result[0]?.departAt).toBe(at("08:00"));

    const departures = result.map((journey) => journey.departAt);
    expect(departures).toEqual([...departures].sort((x, y) => x - y));

    const signatures = result.map((journey) => JSON.stringify(journey.legs));
    expect(new Set(signatures).size).toBe(result.length);

    for (const journey of result) {
      for (const other of result) {
        if (other !== journey) expect(dominates(other, journey)).toBe(false);
      }
    }
  });

  it("includes a walk-only journey when origin and destination are 500 m apart", () => {
    const destination = { lat: 51.7045, lon: 19.46 };
    const options = planOptions(frequent);
    const result = plan(frequent, buildPlanIndex(frequent), pointA, destination, {
      ...options,
      count: 3,
    });

    const walk = result.find((journey) => journey.rides === 0);
    expect(walk).toBeDefined();
    expect(walk?.departAt).toBe(at("08:00"));
    expect((walk?.arriveAt ?? 0) - (walk?.departAt ?? 0)).toBeCloseTo(
      straightLineWalking().seconds(pointA.lat, pointA.lon, destination.lat, destination.lon),
      6,
    );
  });
});
