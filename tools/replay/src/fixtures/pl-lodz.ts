import type { Corridor, InterchangeArea } from "@odjazd/model";

// Phase 1 interchange areas, hand-defined. Radii sit in the gap between each
// stop cluster and the next stops out (checked against the 2026-10-13 feed).
export const lodzAreas: ReadonlyArray<typeof InterchangeArea.Encoded> = [
  {
    slug: "gorniak",
    cityId: "pl-lodz",
    name: "Górniak",
    center: { lat: 51.73999831137485, lon: 19.462652808240104 },
    radiusMeters: 250,
  },
  {
    slug: "piotrkowska-centrum",
    cityId: "pl-lodz",
    name: "Piotrkowska Centrum",
    center: { lat: 51.75925357745903, lon: 19.457179449729978 },
    radiusMeters: 200,
  },
  {
    slug: "mickiewicza-zeromskiego",
    cityId: "pl-lodz",
    name: "Mickiewicza-Żeromskiego",
    center: { lat: 51.757968980433816, lon: 19.448534840732332 },
    radiusMeters: 250,
  },
  {
    slug: "rondo-lotnikow-lwowskich",
    cityId: "pl-lodz",
    name: "Rondo Lotników Lwowskich",
    center: { lat: 51.73144387701628, lon: 19.45277146905974 },
    radiusMeters: 250,
  },
  {
    slug: "dworzec-fabryczna",
    cityId: "pl-lodz",
    name: "Dworzec Łódź Fabryczna",
    center: { lat: 51.76994862334811, lon: 19.466161397125017 },
    radiusMeters: 200,
  },
];

const rondo = "rondo-lotnikow-lwowskich";
const centrum = "piotrkowska-centrum";

// The commute corridors from the project brief, between interchange areas
// (no home/work points: those stay on the user's device).
export const lodzCorridors: ReadonlyArray<typeof Corridor.Encoded> = [
  {
    slug: "via-mickiewicza",
    cityId: "pl-lodz",
    name: "Route 1: via Mickiewicza",
    legs: [
      { from: rondo, to: "mickiewicza-zeromskiego", allow: {} },
      { from: "mickiewicza-zeromskiego", to: centrum, allow: {} },
    ],
  },
  {
    slug: "via-gorniak",
    cityId: "pl-lodz",
    name: "Route 2: via Górniak",
    legs: [
      { from: rondo, to: "gorniak", allow: {} },
      { from: "gorniak", to: centrum, allow: {} },
    ],
  },
  {
    slug: "direct-6-11",
    cityId: "pl-lodz",
    name: "Route 3: direct 6 / 11",
    legs: [{ from: rondo, to: centrum, allow: { lines: ["tram:6", "tram:11"] } }],
  },
  {
    slug: "direct-any",
    cityId: "pl-lodz",
    name: "Reference: any direct vehicle",
    legs: [{ from: rondo, to: centrum, allow: {} }],
  },
];
