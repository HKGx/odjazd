import { Corridor, InterchangeArea, type CityId } from "@odjazd/model";
import { Schema } from "effect";

export interface SeedIntent {
  readonly areas: ReadonlyArray<InterchangeArea>;
  readonly corridors: ReadonlyArray<Corridor>;
}

const Seed = Schema.Struct({
  areas: Schema.Array(InterchangeArea),
  corridors: Schema.Array(Corridor),
});

/** None for now: everyone starts with an empty slate. */
const encoded: Readonly<Record<string, typeof Seed.Encoded>> = {};

/**
 * Intent a city starts with before the user defines their own (areas and
 * corridors). Empty for cities without seeds. Throws if a seed is invalid,
 * which the seed tests rule out.
 */
export const seedIntent = (cityId: CityId): SeedIntent => {
  const seed = encoded[cityId];
  return seed === undefined ? { areas: [], corridors: [] } : Schema.decodeSync(Seed)(seed);
};
