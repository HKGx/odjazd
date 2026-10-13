// @vitest-environment node -- pure helpers; the Solid plugin would default to jsdom.
import { describe, expect, it } from "@effect/vitest";
import { Corridor, LineRef } from "@odjazd/model";
import { defaultPreferences } from "@odjazd/user-data";
import { Schema } from "effect";
import { queryPreferences, withLinePreferences } from "./apply-preferences.ts";
import { slugify } from "./slug.ts";

const corridor = Schema.decodeSync(Corridor)({
  slug: "r",
  cityId: "pl-lodz",
  name: "R",
  legs: [
    { from: "a", to: "b", allow: {}, prefer: ["tram:6"] },
    { from: "b", to: "c", allow: { lines: ["bus:86"] } },
  ],
});
const lines = (...refs: Array<string>) => refs.map((ref) => Schema.decodeSync(LineRef)(ref));

describe("withLinePreferences", () => {
  it("returns the corridor unchanged without global lines", () => {
    expect(withLinePreferences(corridor, defaultPreferences)).toBe(corridor);
  });

  it("adds preferred and avoided lines; a leg's own lines are never avoided", () => {
    const result = withLinePreferences(corridor, {
      ...defaultPreferences,
      preferredLines: lines("tram:10"),
      avoidedLines: lines("tram:6", "bus:86", "bus:58A"),
    });
    expect(result.legs[0].prefer).toEqual(["tram:6", "tram:10"]);
    expect(result.legs[0].avoid).toEqual(["bus:86", "bus:58A"]);
    expect(result.legs[1]?.prefer).toEqual(["tram:10"]);
    expect(result.legs[1]?.avoid).toEqual(["tram:6", "bus:58A"]);
  });

  it("maps preferences to compare-query fields", () => {
    expect(queryPreferences(defaultPreferences)).toEqual({
      transferBufferSec: 60,
      walkingSpeedKmh: 4.5,
      preferencePenaltySec: 240,
    });
  });
});

describe("slugify", () => {
  it("strips Polish diacritics and punctuation", () => {
    expect(slugify("Łódź Fabryczna / Dworzec", new Set())).toBe("lodz-fabryczna-dworzec");
  });

  it("suffixes taken slugs and falls back for symbol-only names", () => {
    expect(slugify("Górniak", new Set(["gorniak", "gorniak-2"]))).toBe("gorniak-3");
    expect(slugify("★★", new Set())).toBe("area");
  });
});
