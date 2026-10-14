// @vitest-environment node -- pure helpers; the Solid plugin would default to jsdom.
import { describe, expect, it } from "@effect/vitest";
import { defaultPreferences } from "@odjazd/user-data";
import { queryPreferences } from "./apply-preferences.ts";
import { slugify } from "./slug.ts";

describe("queryPreferences", () => {
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
