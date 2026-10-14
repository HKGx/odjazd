import type { CityId } from "@odjazd/model";
import { describe, expect, it } from "vitest";
import { seedIntent } from "./seeds.ts";

describe("seedIntent", () => {
  it("is empty for pl-lodz, whose data is no longer a seed", () => {
    expect(seedIntent("pl-lodz" as CityId)).toEqual({ areas: [], corridors: [] });
  });

  it("is empty for cities without seeds", () => {
    expect(seedIntent("pl-nowhere" as CityId)).toEqual({ areas: [], corridors: [] });
  });
});
