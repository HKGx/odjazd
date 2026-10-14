// @vitest-environment node -- pure helpers; the Solid plugin would default to jsdom.
import { describe, expect, it } from "@effect/vitest";
import {
  CityId,
  Corridor,
  distanceMeters,
  InterchangeArea,
  type LegRule,
  LineRef,
} from "@odjazd/model";
import type { JourneyDto } from "@odjazd/worker";
import { Schema } from "effect";
import {
  appendArea,
  chipState,
  cycleChip,
  draftProblem,
  type DraftArea,
  emptyDraft,
  fromCorridor,
  fromJourney,
  hopsOf,
  anyLine,
  moveArea,
  removeArea,
  type RouteDraft,
  setHop,
  toCorridor,
} from "./route-draft.ts";

const cityId = CityId.make("pl-lodz");

const area = (slug: string, name: string, lat: number, lon: number, radiusMeters = 100) =>
  Schema.decodeSync(InterchangeArea)({ slug, cityId, name, center: { lat, lon }, radiusMeters });

const draftOf = (...areas: ReadonlyArray<DraftArea>): RouteDraft => ({
  ...emptyDraft,
  areas,
});

/**
 * Decodes what toCorridor returns. It types legs as a plain array, while the
 * schema wants a non-empty tuple; every draft used here has two or more areas.
 */
const decodeCorridor = (draft: RouteDraft) => {
  const out = toCorridor(draft, "route", cityId);
  return Schema.decodeSync(Corridor)({ ...out, legs: out.legs as [LegRule, ...LegRule[]] });
};

const tram17 = LineRef.make("tram:17");
const tram8 = LineRef.make("tram:8");
const bus101 = LineRef.make("bus:101");

describe("cycleChip", () => {
  it("goes any → preferred → avoided → any", () => {
    let rule = anyLine;
    const states = [chipState(rule, tram17)];
    for (let step = 0; step < 3; step++) {
      rule = cycleChip(rule, tram17);
      states.push(chipState(rule, tram17));
    }
    expect(states).toEqual(["any", "preferred", "avoided", "any"]);
    expect(rule).toEqual(anyLine);
  });

  it("moves a line between prefer and avoid without touching other lines", () => {
    const rule = { ...anyLine, prefer: [tram8], avoid: [bus101] };
    const preferred = cycleChip(rule, tram17);
    expect(preferred.prefer).toEqual([tram8, tram17]);
    expect(preferred.avoid).toEqual([bus101]);

    const avoided = cycleChip(preferred, tram17);
    expect(avoided.prefer).toEqual([tram8]);
    expect(avoided.avoid).toEqual([bus101, tram17]);
    expect(chipState(avoided, tram17)).toBe("avoided");
    expect(chipState(avoided, tram8)).toBe("preferred");
    expect(chipState(avoided, bus101)).toBe("avoided");
  });
});

describe("fromCorridor / toCorridor", () => {
  it("round-trips prefer, avoid, allow.modes, allow.lines (only) and maxWalkMin", () => {
    const areas = [
      area("a", "Alfa", 51.75, 19.45),
      area("b", "Bravo", 51.76, 19.46),
      area("c", "Charlie", 51.77, 19.47),
    ];
    const corridor = Schema.decodeSync(Corridor)({
      slug: "route",
      cityId: "pl-lodz",
      name: "Alfa to Charlie",
      legs: [
        {
          from: "a",
          to: "b",
          allow: { modes: ["tram"] },
          prefer: [tram17],
          avoid: [bus101],
          maxWalkMin: 6,
        },
        { from: "b", to: "c", allow: { lines: [tram8] } },
      ],
    });

    const draft = fromCorridor(corridor, areas);
    expect(draft.name).toBe("Alfa to Charlie");
    expect(draft.areas.map((d) => d.area.slug)).toEqual(["a", "b", "c"]);
    expect(draft.areas.every((d) => d.saved)).toBe(true);

    const back = decodeCorridor(draft);
    expect(back.legs).toEqual(corridor.legs);
    expect(back.name).toBe("Alfa to Charlie");
  });

  it("round-trips a leg that allows more lines than it prefers", () => {
    const areas = [area("a", "Alfa", 51.75, 19.45), area("b", "Bravo", 51.76, 19.46)];
    const corridor = Schema.decodeSync(Corridor)({
      slug: "route",
      cityId: "pl-lodz",
      name: "Alfa to Bravo",
      legs: [
        {
          from: "a",
          to: "b",
          allow: { lines: [tram8, tram17] },
          prefer: [tram8],
        },
      ],
    });
    const back = decodeCorridor(fromCorridor(corridor, areas));
    expect(back.legs).toEqual(corridor.legs);
  });
});

describe("appendArea", () => {
  it("reuses a saved area whose radius covers the point", () => {
    const saved = [area("piotrkowska", "Piotrkowska", 51.7662, 19.459, 150)];
    // About 40 m away from the saved centre, inside its 150 m radius.
    const draft = appendArea(emptyDraft, saved, cityId, "Anything", {
      lat: 51.7665,
      lon: 19.4593,
    });
    expect(draft.areas).toHaveLength(1);
    expect(draft.areas[0]?.saved).toBe(true);
    expect(draft.areas[0]?.area).toEqual(saved[0]);
  });

  it("creates a new area with a slug unique against saved and draft areas", () => {
    const saved = [area("dworzec", "Dworzec", 51.775, 19.47)];
    const draft = draftOf({ area: area("dworzec-2", "Dworzec", 51.76, 19.44), saved: false });
    const next = appendArea(draft, saved, cityId, "Dworzec", { lat: 51.78, lon: 19.48 });
    expect(next.areas).toHaveLength(2);
    expect(next.areas[1]?.saved).toBe(false);
    expect(next.areas[1]?.area.slug).toBe("dworzec-3");
    expect(next.areas[1]?.area.name).toBe("Dworzec");
    expect(next.areas[1]?.area.radiusMeters).toBe(150);
  });

  it("adding the same saved area twice in a row is a no-op", () => {
    const saved = [area("piotrkowska", "Piotrkowska", 51.7662, 19.459, 150)];
    const once = appendArea(emptyDraft, saved, cityId, "Piotrkowska", {
      lat: 51.7662,
      lon: 19.459,
    });
    const twice = appendArea(once, saved, cityId, "Piotrkowska", {
      lat: 51.7664,
      lon: 19.4591,
    });
    expect(twice).toBe(once);
    expect(twice.areas).toHaveLength(1);
  });

  it("adding the same new area twice in a row is a no-op", () => {
    const center = { lat: 51.7701, lon: 19.4512 };
    const once = appendArea(emptyDraft, [], cityId, "Zachodnia", center);
    const twice = appendArea(once, [], cityId, "Zachodnia", center);
    expect(twice).toBe(once);
    expect(twice.areas).toHaveLength(1);
  });
});

describe("moveArea, removeArea and hopsOf", () => {
  const a = area("a", "Alfa", 51.75, 19.45);
  const b = area("b", "Bravo", 51.76, 19.46);
  const c = area("c", "Charlie", 51.77, 19.47);
  const d = area("d", "Delta", 51.78, 19.48);

  it("keeps the rule of a hop that still exists after a move", () => {
    const draft = setHop(
      draftOf(
        { area: a, saved: true },
        { area: b, saved: true },
        { area: c, saved: true },
        {
          area: d,
          saved: true,
        },
      ),
      "c",
      "d",
      { ...anyLine, prefer: [tram8] },
    );
    const moved = moveArea(draft, 0, 1);
    expect(moved.areas.map((x) => x.area.slug)).toEqual(["b", "a", "c", "d"]);
    const hops = hopsOf(moved);
    expect(hops.map((h) => `${h.from.slug}>${h.to.slug}`)).toEqual(["b>a", "a>c", "c>d"]);
    expect(hops[2]?.rule.prefer).toEqual([tram8]);
  });

  it("does nothing when moving past either end", () => {
    const draft = draftOf({ area: a, saved: true }, { area: b, saved: true });
    expect(moveArea(draft, 0, -1)).toBe(draft);
    expect(moveArea(draft, 1, 1)).toBe(draft);
  });

  it("removeArea drops the area at the index and joins its neighbours", () => {
    const draft = draftOf(
      { area: a, saved: true },
      { area: b, saved: true },
      { area: c, saved: true },
    );
    const removed = removeArea(draft, 1);
    expect(removed.areas.map((x) => x.area.slug)).toEqual(["a", "c"]);
    expect(hopsOf(removed).map((h) => `${h.from.slug}>${h.to.slug}`)).toEqual(["a>c"]);
  });

  it("hopsOf falls back to anyLine for hops without a rule", () => {
    const draft = draftOf(
      { area: a, saved: true },
      { area: b, saved: true },
      { area: c, saved: true },
    );
    expect(hopsOf(draft).map((h) => h.rule)).toEqual([anyLine, anyLine]);
    expect(hopsOf(emptyDraft)).toEqual([]);
  });
});

describe("draftProblem", () => {
  const a = area("a", "Alfa", 51.75, 19.45);
  const b = area("b", "Bravo", 51.76, 19.46);
  const valid = {
    ...draftOf({ area: a, saved: true }, { area: b, saved: true }),
    name: "Alfa–Bravo",
  };

  it("asks for at least two areas", () => {
    expect(draftProblem(emptyDraft)).toMatch(/at least two areas/);
    expect(draftProblem({ ...valid, areas: [valid.areas[0] as DraftArea] })).toMatch(
      /at least two areas/,
    );
  });

  it("asks for a name, ignoring surrounding spaces", () => {
    expect(draftProblem({ ...valid, name: "" })).toBe("Give the route a name.");
    expect(draftProblem({ ...valid, name: "   " })).toBe("Give the route a name.");
  });

  it("returns undefined for a valid draft", () => {
    expect(draftProblem(valid)).toBeUndefined();
  });
});

describe("fromJourney", () => {
  // Tram 17 from A to B; B's radius is 100 m and tram 8 boards at B2, 150 m away.
  const A = area("kopernika", "Kopernika", 51.765, 19.456);
  const B = area("zachodnia", "Zachodnia", 51.77, 19.45);
  const B2 = area("zachodnia-tram", "Zachodnia tram", 51.77135, 19.45);
  const C = area("retkinia", "Retkinia", 51.74, 19.42);
  const Q = area("stoki", "Stoki", 51.8, 19.5);

  const ride = (
    label: string,
    from: InterchangeArea,
    to: InterchangeArea,
    stayAboard = false,
  ): JourneyDto["legs"][number] => ({
    _tag: "Ride",
    line: { id: `tram:${label}@mpk-lodz`, label, mode: "tram" },
    headsign: "Kurak",
    trip: `trip-${label}-${from.slug}`,
    from: from.name,
    to: to.name,
    fromGroup: 1,
    departAt: 1_000,
    arriveAt: 1_600,
    scheduledDepartAt: 1_000,
    scheduledArriveAt: 1_600,
    stops: 6,
    preferred: true,
    stayAboard,
    section: { from, to, rule: { from: from.slug, to: to.slug, allow: {} } },
    path: [
      { lat: from.center.lat, lon: from.center.lon },
      { lat: to.center.lat, lon: to.center.lon },
    ],
  });

  const walk: JourneyDto["legs"][number] = {
    _tag: "Walk",
    departAt: 1_600,
    arriveAt: 1_660,
    meters: 150,
    path: [
      { lat: B.center.lat, lon: B.center.lon },
      { lat: B2.center.lat, lon: B2.center.lon },
    ],
  };

  const journeyWith = (legs: JourneyDto["legs"]): JourneyDto => ({
    departAt: 1_000,
    arriveAt: 2_400,
    rides: 2,
    walkMeters: 150,
    live: false,
    legs,
    reasons: [],
  });

  it("builds areas, hops and a name from the rides", () => {
    const journey = journeyWith([ride("17", A, B), walk, ride("8", B2, C)]);
    const draft = fromJourney(journey, [], cityId);

    expect(draft.areas).toHaveLength(3);
    expect(draft.areas.map((d) => d.area.name)).toEqual(["Kopernika", "Zachodnia", "Retkinia"]);
    expect(draft.areas[0]?.area.slug).toBe("kopernika");
    expect(draft.areas.every((d) => !d.saved)).toBe(true);
    expect(draft.name).toBe("Kopernika → Retkinia");

    // The middle area is one new area covering both the alight and the boarding.
    const middle = draft.areas[1]?.area;
    expect(middle).toBeDefined();
    const gap = distanceMeters(B.center.lat, B.center.lon, B2.center.lat, B2.center.lon);
    expect(gap).toBeGreaterThan(B.radiusMeters);
    expect(
      distanceMeters(middle?.center.lat ?? 0, middle?.center.lon ?? 0, B.center.lat, B.center.lon),
    ).toBeLessThanOrEqual(middle?.radiusMeters ?? 0);
    expect(
      distanceMeters(
        middle?.center.lat ?? 0,
        middle?.center.lon ?? 0,
        B2.center.lat,
        B2.center.lon,
      ),
    ).toBeLessThanOrEqual(middle?.radiusMeters ?? 0);

    const hops = hopsOf(draft);
    expect(hops.map((h) => [h.from.slug, h.to.slug])).toEqual([
      [draft.areas[0]?.area.slug, draft.areas[1]?.area.slug],
      [draft.areas[1]?.area.slug, draft.areas[2]?.area.slug],
    ]);
    expect(hops.map((h) => h.rule.prefer)).toEqual([[tram17], [tram8]]);
    expect(hops.map((h) => h.rule.avoid)).toEqual([[], []]);
  });

  it("skips a stayAboard ride", () => {
    const journey = journeyWith([ride("17", A, B), ride("17", B, Q, true), walk, ride("8", B2, C)]);
    const draft = fromJourney(journey, [], cityId);

    expect(draft.areas.map((d) => d.area.name)).toEqual(["Kopernika", "Zachodnia", "Retkinia"]);
    expect(draft.name).toBe("Kopernika → Retkinia");
    expect(hopsOf(draft).map((h) => h.rule.prefer)).toEqual([[tram17], [tram8]]);
  });
});
