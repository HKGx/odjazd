import { describe, expect, it } from "vitest";
import { InterchangeArea } from "./area.ts";
import { distanceMeters } from "./geo.ts";

describe("distanceMeters", () => {
  it("one degree of latitude is ~111.2 km", () => {
    expect(distanceMeters(0, 0, 1, 0)).toBeCloseTo(111_195, 0);
  });

  it("is symmetric and zero for the same point", () => {
    const a = distanceMeters(51.74, 19.4627, 51.7699, 19.4662);
    expect(distanceMeters(51.7699, 19.4662, 51.74, 19.4627)).toBe(a);
    expect(distanceMeters(51.74, 19.46, 51.74, 19.46)).toBe(0);
  });

  it("matches a known distance in Łódź (Górniak → Dw. Fabryczna, ~3.3 km)", () => {
    const d = distanceMeters(
      51.73999831137485,
      19.462652808240104,
      51.76994862334811,
      19.466161397125017,
    );
    expect(d).toBeGreaterThan(3_300);
    expect(d).toBeLessThan(3_360);
  });
});

describe("InterchangeArea", () => {
  const area = {
    slug: "gorniak",
    cityId: "pl-lodz",
    name: "Górniak",
    center: { lat: 51.74, lon: 19.46 },
    radiusMeters: 250,
  };

  it("accepts a valid area", () => {
    expect(InterchangeArea.make(area as InterchangeArea).slug).toBe("gorniak");
  });

  it.each([
    { slug: "Górniak" },
    { radiusMeters: 0 },
    { radiusMeters: 5000 },
    { radiusMeters: 2.5 },
    { name: "" },
  ])("rejects %j", (patch) => {
    expect(() => InterchangeArea.make({ ...area, ...patch } as InterchangeArea)).toThrow();
  });
});
