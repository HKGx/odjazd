import { distanceMeters, type Corridor, type EpochSeconds, type LegRule } from "@odjazd/model";
import { scheduleRealization, straightLineWalking } from "@odjazd/prediction";
import { describe, expect, it } from "vitest";
import type { EvaluationOptions } from "./evaluate.ts";
import { chainOf, matchRoutes, routeOptions, sectionLines, sectionOptions } from "./routes.ts";
import { area, at, buildTimetable, type TripSpec } from "./test-timetable.ts";

// Areas ~2.2 km apart on a meridian: a (51.70), b (51.72), c (51.74).
const areas = [area("a", 51.7, 19.46), area("b", 51.72, 19.46), area("c", 51.74, 19.46)];

const corridorOf = (slug: string, ...pairs: ReadonlyArray<readonly [string, string]>) =>
  ({
    slug,
    cityId: "pl-test",
    name: slug,
    legs: pairs.map(([from, to]) => ({ from, to, allow: {} })),
  }) as unknown as Corridor;

const legRule = (extra: Record<string, unknown> = {}) =>
  ({ from: "a", to: "b", allow: {}, ...extra }) as unknown as LegRule;

const walking = straightLineWalking();

const optionsFor = (
  trips: ReadonlyArray<TripSpec>,
  stops: ReadonlyArray<readonly [string, number, number]>,
) => {
  const timetable = buildTimetable(stops, trips);
  const options: EvaluationOptions = {
    timetable,
    realization: scheduleRealization(timetable),
    walking,
    transferBufferSec: 60,
    nonPreferredPenaltySec: 0,
    maxWaitSec: 3600,
  };
  return options;
};

describe("chainOf", () => {
  it("returns the first leg's origin followed by each leg's destination", () => {
    expect(chainOf(corridorOf("r", ["a", "b"], ["b", "c"]))).toEqual(["a", "b", "c"]);
  });
});

describe("matchRoutes", () => {
  const route = corridorOf("abc", ["a", "b"], ["b", "c"]);
  const inA = { lat: 51.7, lon: 19.46 };
  const inB = { lat: 51.72, lon: 19.46 };
  const inC = { lat: 51.74, lon: 19.46 };

  it("uses the full route when origin and destination are inside its end areas", () => {
    const [match] = matchRoutes([route], areas, inA, inC, walking, 900);
    expect(match?.fromLeg).toBe(0);
    expect(match?.toLeg).toBe(2);
    expect(match?.accessSec).toBe(0);
    expect(match?.egressSec).toBe(0);
    expect(match?.used.legs.length).toBe(2);
  });

  it("uses the sub-route from the area near the origin when the origin is near the middle", () => {
    const [match] = matchRoutes([route], areas, inB, inC, walking, 900);
    expect(match?.fromLeg).toBe(1);
    expect(match?.toLeg).toBe(2);
    expect(match?.used.legs.length).toBe(1);
    expect(match?.used.legs[0]?.from).toBe("b");
    expect(match?.used.legs[0]?.to).toBe("c");
  });

  it("finds no match when the destination is out of walking reach of every area", () => {
    // ~5.3 km east of area b: more than 5 km from a, b and c alike.
    const far = { lat: 51.72, lon: 19.46 + 0.0729 };
    for (const area of areas) {
      expect(distanceMeters(far.lat, far.lon, area.center.lat, area.center.lon)).toBeGreaterThan(
        5000,
      );
    }
    expect(matchRoutes([route], areas, inA, far, walking, 900)).toEqual([]);
  });

  it("skips a route that references an unknown area", () => {
    const ghost = corridorOf("ghost", ["a", "nowhere"]);
    const matches = matchRoutes([ghost, route], areas, inA, inC, walking, 900);
    expect(matches.map((match) => match.corridor.slug)).toEqual(["abc"]);
  });
});

describe("routeOptions", () => {
  // Stop a1 at area a's center, b1 at area b's center; trips every 10 minutes.
  const stops = [
    ["a1", 51.7, 19.46],
    ["b1", 51.72, 19.46],
  ] as const;
  const trips: ReadonlyArray<TripSpec> = [
    {
      line: "tram:1",
      id: "t0800",
      stops: [
        ["a1", "08:00"],
        ["b1", "08:10"],
      ],
    },
    {
      line: "tram:1",
      id: "t0810",
      stops: [
        ["a1", "08:10"],
        ["b1", "08:20"],
      ],
    },
    {
      line: "tram:1",
      id: "t0820",
      stops: [
        ["a1", "08:20"],
        ["b1", "08:30"],
      ],
    },
    {
      line: "tram:1",
      id: "t0830",
      stops: [
        ["a1", "08:30"],
        ["b1", "08:40"],
      ],
    },
  ];
  const options = optionsFor(trips, stops);
  // ~100 m south of a1 (walk ~104 s) and ~300 m north of b1, outside b's radius.
  const origin = { lat: 51.6991, lon: 19.46 };
  const destination = { lat: 51.7227, lon: 19.46 };
  const [match] = matchRoutes(
    [corridorOf("ab", ["a", "b"])],
    areas,
    origin,
    destination,
    walking,
    900,
  );

  it("returns up to count departures in order, leaving the origin walk ahead of the vehicle", () => {
    if (match === undefined) throw new Error("expected a match");
    const found = routeOptions(
      options,
      match,
      areas,
      origin,
      destination,
      at("07:50") as EpochSeconds,
      3,
    );
    expect(found.map((option) => option.legs[0]?.departAt)).toEqual([
      at("08:00"),
      at("08:10"),
      at("08:20"),
    ]);
    const walkSec = walking.seconds(origin.lat, origin.lon, 51.7, 19.46);
    for (const option of found) {
      expect(option.match).toBe(match);
      expect(option.departAt).toBe(
        (option.legs[0]?.departAt ?? 0) - (option.legs[0]?.walkSec ?? 0),
      );
      expect(option.departAt).toBeCloseTo((option.legs[0]?.departAt ?? 0) - walkSec, 0);
    }
  });

  it("stops at the number of departures available", () => {
    if (match === undefined) throw new Error("expected a match");
    const found = routeOptions(
      options,
      match,
      areas,
      origin,
      destination,
      at("07:50") as EpochSeconds,
      10,
    );
    expect(found.map((option) => option.legs[0]?.departAt)).toEqual([
      at("08:00"),
      at("08:10"),
      at("08:20"),
      at("08:30"),
    ]);
  });

  it("adds the final walk from the alighting stop to the destination point", () => {
    if (match === undefined) throw new Error("expected a match");
    const [first] = routeOptions(
      options,
      match,
      areas,
      origin,
      destination,
      at("07:50") as EpochSeconds,
      1,
    );
    const lastArrive = first?.legs.at(-1)?.arriveAt ?? 0;
    const finalWalk = walking.seconds(51.72, 19.46, destination.lat, destination.lon);
    expect(first?.arriveAt).toBe(Math.round(lastArrive + finalWalk));
    expect(first?.arriveAt).toBeGreaterThan(lastArrive);
  });
});

describe("sectionOptions", () => {
  // a1 is at area a's center, b1 at b's, x1 is in another area.
  const stops = [
    ["a1", 51.7, 19.46],
    ["b1", 51.72, 19.46],
    ["x1", 51.74, 19.46],
  ] as const;
  const trips: ReadonlyArray<TripSpec> = [
    {
      line: "tram:1",
      id: "one-a",
      stops: [
        ["a1", "08:05"],
        ["b1", "08:15"],
      ],
    },
    {
      line: "tram:1",
      id: "one-b",
      stops: [
        ["a1", "08:20"],
        ["b1", "08:30"],
      ],
    },
    {
      line: "tram:2",
      id: "two",
      stops: [
        ["a1", "08:10"],
        ["b1", "08:18"],
      ],
    },
    {
      line: "tram:3",
      id: "three",
      stops: [
        ["a1", "08:12"],
        ["x1", "08:25"],
      ],
    },
  ];
  const timetable = buildTimetable(stops, trips);
  const realization = scheduleRealization(timetable);
  const fromArea = areas[0];
  const toArea = areas[1];
  const atA = { lat: 51.7, lon: 19.46 };

  it("lists lines serving the section, soonest first, with their reachable departures", () => {
    if (fromArea === undefined || toArea === undefined) throw new Error("missing areas");
    const sections = sectionOptions(
      timetable,
      realization,
      walking,
      legRule(),
      fromArea,
      toArea,
      atA,
      at("08:00"),
      0,
    );
    expect(sections.map((section) => section.line)).toEqual(["tram:1@test", "tram:2@test"]);
    expect(sections.map((section) => section.departures.map((d) => d.departAt))).toEqual([
      [at("08:05"), at("08:20")],
      [at("08:10")],
    ]);
    expect(sections.every((section) => section.preferred === false)).toBe(true);
  });

  it("excludes departures the rider cannot reach on foot in time", () => {
    if (fromArea === undefined || toArea === undefined) throw new Error("missing areas");
    // 1 km north of a1: ~17 min on foot, so only the 08:20 departure is reachable.
    const position = { lat: 51.709, lon: 19.46 };
    const sections = sectionOptions(
      timetable,
      realization,
      walking,
      legRule(),
      fromArea,
      toArea,
      position,
      at("08:00"),
      0,
    );
    expect(sections.map((section) => section.line)).toEqual(["tram:1@test"]);
    expect(sections[0]?.departures.map((d) => d.departAt)).toEqual([at("08:20")]);
  });

  it("marks preferred lines", () => {
    if (fromArea === undefined || toArea === undefined) throw new Error("missing areas");
    const sections = sectionOptions(
      timetable,
      realization,
      walking,
      legRule({ prefer: ["tram:2"] }),
      fromArea,
      toArea,
      atA,
      at("08:00"),
      0,
    );
    expect(sections.map((section) => [section.line, section.preferred])).toEqual([
      ["tram:1@test", false],
      ["tram:2@test", true],
    ]);
  });

  it("drops lines the rule avoids", () => {
    if (fromArea === undefined || toArea === undefined) throw new Error("missing areas");
    const sections = sectionOptions(
      timetable,
      realization,
      walking,
      legRule({ avoid: ["tram:1"] }),
      fromArea,
      toArea,
      atA,
      at("08:00"),
      0,
    );
    expect(sections.map((section) => section.line)).toEqual(["tram:2@test"]);
  });
});

describe("sectionLines", () => {
  const stops = [
    ["a1", 51.7, 19.46],
    ["b1", 51.72, 19.46],
    ["x1", 51.74, 19.46],
  ] as const;
  const trips: ReadonlyArray<TripSpec> = [
    // tram:1: three runs, rides of 10, 12 and 15 minutes (median 12).
    {
      line: "tram:1",
      id: "p1",
      stops: [
        ["a1", "08:00"],
        ["b1", "08:10"],
      ],
    },
    {
      line: "tram:1",
      id: "p2",
      stops: [
        ["a1", "08:20"],
        ["b1", "08:32"],
      ],
    },
    {
      line: "tram:1",
      id: "p3",
      stops: [
        ["a1", "08:40"],
        ["b1", "08:55"],
      ],
    },
    // tram:2: four runs of 8 minutes, more often than tram:1 though it sorts later.
    {
      line: "tram:2",
      id: "q1",
      stops: [
        ["a1", "08:05"],
        ["b1", "08:13"],
      ],
    },
    {
      line: "tram:2",
      id: "q2",
      stops: [
        ["a1", "09:05"],
        ["b1", "09:13"],
      ],
    },
    {
      line: "tram:2",
      id: "q3",
      stops: [
        ["a1", "10:05"],
        ["b1", "10:13"],
      ],
    },
    {
      line: "tram:2",
      id: "q4",
      stops: [
        ["a1", "11:05"],
        ["b1", "11:13"],
      ],
    },
    // bus:5 runs a -> x, not a -> b: not part of this section.
    {
      line: "bus:5",
      id: "z1",
      stops: [
        ["a1", "08:30"],
        ["x1", "08:50"],
      ],
    },
  ];
  const timetable = buildTimetable(stops, trips);
  const realization = scheduleRealization(timetable);

  it("counts trips per line between two areas and takes the median ride, most trips first", () => {
    const fromArea = areas[0];
    const toArea = areas[1];
    if (fromArea === undefined || toArea === undefined) throw new Error("missing areas");
    expect(
      sectionLines(
        timetable,
        realization,
        fromArea,
        toArea,
        at("06:00") as EpochSeconds,
        at("23:00") as EpochSeconds,
      ),
    ).toEqual([
      { line: "tram:2@test", trips: 4, rideSec: 480 },
      { line: "tram:1@test", trips: 3, rideSec: 720 },
    ]);
  });
});
