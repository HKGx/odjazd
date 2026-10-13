import type { CityId } from "@odjazd/model";
import { describe, expect, it } from "vitest";
import { seedIntent } from "./seeds.ts";

describe("seedIntent", () => {
  it("decodes the pl-lodz seed and every corridor uses known areas", () => {
    const { areas, corridors } = seedIntent("pl-lodz" as CityId);
    const slugs = new Set(areas.map((area) => area.slug));
    expect(areas.length).toBe(5);
    for (const corridor of corridors) {
      expect(corridor.cityId).toBe("pl-lodz");
      for (const leg of corridor.legs) {
        expect(slugs.has(leg.from) && slugs.has(leg.to)).toBe(true);
      }
    }
  });

  it("is empty for cities without seeds", () => {
    expect(seedIntent("pl-nowhere" as CityId)).toEqual({ areas: [], corridors: [] });
  });
});
