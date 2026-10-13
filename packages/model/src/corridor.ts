import { Schema } from "effect";
import { AreaSlug } from "./area.ts";
import { CityId } from "./ids.ts";
import { LineRef, Mode } from "./line.ts";

/**
 * Stored intent for one leg between two interchange areas. Never references
 * feed ids: which lines and trips qualify is resolved against the current feed
 * at query time, so replacement lines are picked up automatically.
 */
export const LegRule = Schema.Struct({
  from: AreaSlug,
  to: AreaSlug,
  allow: Schema.Struct({
    /** Only these modes; all modes when absent. */
    modes: Schema.optionalKey(Schema.Array(Mode)),
    /** Only these lines; any line serving the leg when absent. */
    lines: Schema.optionalKey(Schema.Array(LineRef)),
  }),
  /** Soft preference: other lines count as departing `nonPreferredPenaltyMin` later. */
  prefer: Schema.optionalKey(Schema.Array(LineRef)),
  /** Hard exclusion. */
  avoid: Schema.optionalKey(Schema.Array(LineRef)),
  /** Longest walk to the boarding stop within the `from` area, minutes. */
  maxWalkMin: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThan(0))),
});
export type LegRule = typeof LegRule.Type;

/** An ordered chain of interchange areas, one leg rule per hop. */
export const Corridor = Schema.Struct({
  slug: AreaSlug,
  cityId: CityId,
  name: Schema.String.check(Schema.isMinLength(1)),
  legs: Schema.NonEmptyArray(LegRule),
}).check(
  Schema.makeFilter((corridor) =>
    corridor.legs.flatMap((leg, i) => {
      const next = corridor.legs[i + 1];
      const issues: Array<Schema.FilterIssue> = [];
      if (leg.from === leg.to) {
        issues.push({ path: ["legs", i], issue: "leg starts and ends in the same area" });
      }
      if (next !== undefined && next.from !== leg.to) {
        issues.push({ path: ["legs", i + 1, "from"], issue: `must continue from ${leg.to}` });
      }
      return issues;
    }),
  ),
);
export type Corridor = typeof Corridor.Type;
