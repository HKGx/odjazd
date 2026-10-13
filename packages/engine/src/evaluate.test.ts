import { Corridor, LegRule, type EpochSeconds } from "@odjazd/model";
import { scheduleRealization, straightLineWalking } from "@odjazd/prediction";
import { StopTimeFlag, type Timetable } from "@odjazd/timetable";
import { describe, expect, it } from "vitest";
import { compareCorridors } from "./compare.ts";
import {
  evaluateFirstSuitable,
  evaluateWindow,
  prepareCorridor,
  type EvaluationOptions,
} from "./evaluate.ts";
import { area, at, buildTimetable, type TripSpec } from "./test-timetable.ts";

// Three areas ~1.1 km apart on a meridian. a2 is ~55 m from A's center
// (~57 s on foot at 4.5 km/h × 1.3).
const stops = [
  ["a1", 51.7, 19.46],
  ["a2", 51.7005, 19.46],
  ["m1", 51.71, 19.46],
  ["c1", 51.72, 19.46],
] as const;
const areas = [area("a", 51.7, 19.46), area("m", 51.71, 19.46), area("c", 51.72, 19.46)];

const legRule = (from: string, to: string, extra: Partial<typeof LegRule.Encoded> = {}) =>
  LegRule.make({ from, to, allow: {}, ...extra } as LegRule);
const corridor = (...legs: ReadonlyArray<LegRule>) =>
  Corridor.make({ slug: "test", cityId: "pl-test", name: "Test", legs } as unknown as Corridor);

const optionsFor = (timetable: Timetable, overrides: Partial<EvaluationOptions> = {}) => ({
  timetable,
  realization: scheduleRealization(timetable),
  walking: straightLineWalking(),
  transferBufferSec: 60,
  nonPreferredPenaltySec: 0,
  maxWaitSec: 3600,
  ...overrides,
});

const run = (
  trips: ReadonlyArray<TripSpec>,
  c: Corridor,
  departAt: string,
  overrides: Partial<EvaluationOptions> = {},
) => {
  const options = optionsFor(buildTimetable(stops, trips), overrides);
  const prepared = prepareCorridor(
    options,
    c,
    areas,
    at("06:00") as EpochSeconds,
    at("12:00") as EpochSeconds,
  );
  return {
    prepared,
    result: evaluateFirstSuitable(options, prepared, at(departAt) as EpochSeconds),
  };
};
const lines = (result: ReturnType<typeof run>["result"]) => result?.legs.map((leg) => leg.line);

const direct = corridor(legRule("a", "c"));

describe("evaluateFirstSuitable", () => {
  it("boards whatever comes first, even if a later vehicle arrives sooner", () => {
    const { result } = run(
      [
        {
          line: "tram:1",
          id: "fast",
          stops: [
            ["a1", "08:05"],
            ["c1", "08:15"],
          ],
        },
        {
          line: "bus:2",
          id: "slow",
          stops: [
            ["a1", "08:02"],
            ["c1", "08:30"],
          ],
        },
      ],
      direct,
      "08:00",
    );
    expect(lines(result)).toEqual(["bus:2@test"]);
    expect(result?.legs[0]?.waitSec).toBe(120);
    expect(result?.arriveAt).toBe(at("08:30"));
  });

  it("skips departures the rider can't walk to in time", () => {
    const { result } = run(
      [
        {
          line: "tram:1",
          id: "too-soon",
          stops: [
            ["a2", "08:00:30"],
            ["c1", "08:10"],
          ],
        },
        {
          line: "tram:1",
          id: "ok",
          stops: [
            ["a2", "08:01:30"],
            ["c1", "08:11"],
          ],
        },
      ],
      direct,
      "08:00",
    );
    expect(result?.legs[0]?.tripFeedId).toBe("ok");
    expect(result?.legs[0]?.walkSec).toBeGreaterThan(50);
    expect(result?.legs[0]?.walkSec).toBeLessThan(60);
  });

  it("requires the transfer buffer at interchanges", () => {
    const trips: ReadonlyArray<TripSpec> = [
      {
        line: "tram:1",
        id: "in",
        stops: [
          ["a1", "08:00"],
          ["m1", "08:10"],
        ],
      },
      {
        line: "tram:2",
        id: "tight",
        stops: [
          ["m1", "08:10:30"],
          ["c1", "08:20"],
        ],
      },
      {
        line: "tram:2",
        id: "next",
        stops: [
          ["m1", "08:15"],
          ["c1", "08:25"],
        ],
      },
    ];
    const viaM = corridor(legRule("a", "m"), legRule("m", "c"));
    expect(run(trips, viaM, "08:00").result?.legs[1]?.tripFeedId).toBe("next");
    const noBuffer = run(trips, viaM, "08:00", { transferBufferSec: 0 }).result;
    expect(noBuffer?.legs[1]?.tripFeedId).toBe("tight");
    expect(noBuffer?.arriveAt).toBe(at("08:20"));
  });

  it("stays aboard through an interchange instead of missing its own vehicle", () => {
    const trips: ReadonlyArray<TripSpec> = [
      {
        line: "tram:11",
        id: "through",
        stops: [
          ["a1", "08:00"],
          ["m1", "08:05"],
          ["c1", "08:15"],
        ],
      },
      {
        line: "tram:6",
        id: "other",
        stops: [
          ["m1", "08:20"],
          ["c1", "08:30"],
        ],
      },
    ];
    const { result } = run(trips, corridor(legRule("a", "m"), legRule("m", "c")), "08:00");
    expect(result?.legs.map((leg) => [leg.tripFeedId, leg.stayedAboard])).toEqual([
      ["through", false],
      ["through", true],
    ]);
    expect(result?.legs[1]?.walkSec).toBe(0);
    expect(result?.arriveAt).toBe(at("08:15"));
  });

  it("allow.lines and avoid filter lines; prefer is a soft penalty", () => {
    const trips: ReadonlyArray<TripSpec> = [
      {
        line: "bus:80",
        id: "bus",
        stops: [
          ["a1", "08:01"],
          ["c1", "08:20"],
        ],
      },
      {
        line: "tram:6",
        id: "six",
        stops: [
          ["a1", "08:03"],
          ["c1", "08:15"],
        ],
      },
      {
        line: "tram:11",
        id: "eleven",
        stops: [
          ["a1", "08:06"],
          ["c1", "08:16"],
        ],
      },
    ];
    const only11 = corridor(legRule("a", "c", { allow: { lines: ["tram:11"] } }));
    expect(lines(run(trips, only11, "08:00").result)).toEqual(["tram:11@test"]);

    const trams = corridor(legRule("a", "c", { allow: { modes: ["tram"] }, avoid: ["tram:6"] }));
    expect(lines(run(trips, trams, "08:00").result)).toEqual(["tram:11@test"]);

    const prefer11 = corridor(legRule("a", "c", { prefer: ["tram:11"] }));
    expect(lines(run(trips, prefer11, "08:00").result)).toEqual(["bus:80@test"]);
    const penalized = run(trips, prefer11, "08:00", { nonPreferredPenaltySec: 300 }).result;
    expect(lines(penalized)).toEqual(["tram:11@test"]);
  });

  it("ignores stops where boarding or alighting isn't allowed", () => {
    const { result } = run(
      [
        {
          line: "tram:1",
          id: "no-pickup",
          stops: [
            ["a1", "08:01", StopTimeFlag.noPickup],
            ["c1", "08:10"],
          ],
        },
        {
          line: "tram:1",
          id: "no-dropoff",
          stops: [
            ["a1", "08:02"],
            ["c1", "08:11", StopTimeFlag.noDropOff],
          ],
        },
        {
          line: "tram:1",
          id: "ok",
          stops: [
            ["a1", "08:03"],
            ["c1", "08:12"],
          ],
        },
      ],
      direct,
      "08:00",
    );
    expect(result?.legs[0]?.tripFeedId).toBe("ok");
  });

  it("only rides from the from-area towards the to-area", () => {
    const { result } = run(
      [
        {
          line: "tram:1",
          id: "backwards",
          stops: [
            ["c1", "08:01"],
            ["a1", "08:10"],
          ],
        },
      ],
      direct,
      "08:00",
    );
    expect(result).toBeUndefined();
  });

  it("gives up when nothing departs within maxWaitSec", () => {
    const trips: ReadonlyArray<TripSpec> = [
      {
        line: "tram:1",
        id: "late",
        stops: [
          ["a1", "09:30"],
          ["c1", "09:40"],
        ],
      },
    ];
    expect(run(trips, direct, "08:00", { maxWaitSec: 3600 }).result).toBeUndefined();
    expect(run(trips, direct, "08:00", { maxWaitSec: 7200 }).result?.arriveAt).toBe(at("09:40"));
  });

  it("reports what each leg resolved to", () => {
    const { prepared } = run(
      [
        {
          line: "tram:1",
          id: "x",
          stops: [
            ["a1", "08:00"],
            ["m1", "08:05"],
            ["c1", "08:10"],
          ],
        },
        {
          line: "tram:1",
          id: "y",
          stops: [
            ["a1", "08:10"],
            ["m1", "08:15"],
            ["c1", "08:20"],
          ],
        },
        {
          line: "bus:9",
          id: "z",
          stops: [
            ["m1", "08:00"],
            ["c1", "08:05"],
          ],
        },
      ],
      corridor(legRule("a", "m"), legRule("m", "c")),
      "08:00",
    );
    expect(prepared.legs.map((leg) => leg.lines)).toEqual([
      [{ id: "tram:1@test", instances: 2 }],
      [
        { id: "tram:1@test", instances: 2 },
        { id: "bus:9@test", instances: 1 },
      ],
    ]);
  });
});

describe("evaluateWindow", () => {
  it("evaluates every step", () => {
    const timetable = buildTimetable(stops, [
      {
        line: "tram:1",
        id: "t1",
        stops: [
          ["a1", "08:05"],
          ["c1", "08:15"],
        ],
      },
      {
        line: "tram:1",
        id: "t2",
        stops: [
          ["a1", "08:20"],
          ["c1", "08:30"],
        ],
      },
    ]);
    const options = optionsFor(timetable);
    const prepared = prepareCorridor(
      options,
      direct,
      areas,
      at("08:00") as EpochSeconds,
      at("08:30") as EpochSeconds,
    );
    const rows = evaluateWindow(
      options,
      prepared,
      at("08:00") as EpochSeconds,
      at("08:30") as EpochSeconds,
      600,
    );
    expect(rows.map((row) => row.itinerary?.arriveAt)).toEqual([
      at("08:15"),
      at("08:30"),
      at("08:30"),
      undefined,
    ]);
  });
});

describe("prepareCorridor", () => {
  it("throws on an unknown area", () => {
    const options = optionsFor(buildTimetable(stops, []));
    expect(() =>
      prepareCorridor(
        options,
        corridor(legRule("a", "nowhere")),
        areas,
        0 as EpochSeconds,
        1 as EpochSeconds,
      ),
    ).toThrow("unknown area nowhere");
  });
});

describe("compareCorridors", () => {
  it("evaluates corridors under the same inputs and summarizes them", () => {
    const timetable = buildTimetable(stops, [
      {
        line: "tram:1",
        id: "d1",
        stops: [
          ["a1", "08:05"],
          ["c1", "08:15"],
        ],
      },
      {
        line: "tram:2",
        id: "m1",
        stops: [
          ["a1", "08:01"],
          ["m1", "08:06"],
        ],
      },
      {
        line: "tram:3",
        id: "m2",
        stops: [
          ["m1", "08:08"],
          ["c1", "08:12"],
        ],
      },
    ]);
    const options = optionsFor(timetable);
    const viaM = corridor(legRule("a", "m"), legRule("m", "c"));
    const { rows, summaries } = compareCorridors(
      options,
      [direct, viaM],
      areas,
      at("08:00") as EpochSeconds,
      at("08:00") as EpochSeconds,
      60,
    );
    expect(rows[0]?.results.map((r) => r?.arriveAt)).toEqual([at("08:15"), at("08:12")]);
    expect(
      summaries.map((s) => [s.feasible, s.earliest, s.meanMinutes, s.meanLossMinutes]),
    ).toEqual([
      [1, 0, 15, 3],
      [1, 1, 12, 0],
    ]);
  });
});
